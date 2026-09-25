import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { getSectionRoles, hasAnyRole } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "../db.js";
import { decodeRosterBytes, parseCsv, readRoster, type RosterFileRow } from "../roster-file.js";

// Section roster import from the registrar's student list (PS-TASK-20260925-744). The file is
// sent as base64 twice -- once for the preview, once with the teacher's confirmation -- and both
// run the same plan, so nothing of the file is stored except the rows that become memberships or
// pending entries.

const MAX_FILE_BYTES = 512 * 1024;
const studentIdPattern = /^[0-9A-Za-z-]{1,32}$/;
const emailSchema = z.email();
const importSchema = z.object({
  fileBase64: z.string().min(1).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 8),
  encoding: z.enum(["auto", "utf-8", "tis-620"]).default("auto"),
  // Which SECTION value of the file feeds this ClassOps Section, when the file has several.
  section: z.string().trim().max(32).nullable().optional(),
  // Column mapping chosen in the preview (PS-TASK-20260925-747); omitted = suggested from the header.
  mapping: z
    .object({
      studentId: z.string().max(200),
      email: z.string().max(200),
      nameTh: z.array(z.string().max(200)).max(5).default([]),
      nameEn: z.array(z.string().max(200)).max(5).default([]),
      section: z.string().max(200).nullable().default(null),
      courseCode: z.string().max(200).nullable().default(null),
    })
    .optional(),
});

type RowStatus =
  | "enroll"
  | "update"
  | "unchanged"
  | "pending"
  | "invalid"
  | "duplicate"
  | "other_section"
  | "staff";

interface PlannedRow {
  line: number;
  studentId: string;
  email: string;
  nameTh: string | null;
  nameEn: string | null;
  status: RowStatus;
  // A member whose own student ID differs from the roster's: the roster wins (decision 2).
  studentIdConflict: string | null;
  userId: string | null;
  reason: string | null;
}

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

/**
 * Turn every pending roster entry for `email` into a student Membership (all Sections), inside
 * the caller's transaction. Called when an account signs in. Returns the Sections claimed.
 */
export async function claimRosterByEmail(db: DatabaseClient | DatabasePool, userId: string, email: string) {
  const entries = await db.query<{ id: string; section_id: string; student_id: string; name_th: string | null; name_en: string | null; email: string }>(
    "DELETE FROM section_roster_entries WHERE email = $1 RETURNING id, section_id, student_id, name_th, name_en, email::text",
    [email],
  );
  for (const entry of entries.rows) await enrollFromRoster(db, userId, entry);
  if (entries.rowCount) {
    await db.query(
      `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
       VALUES ($1, 'roster.claimed', 'user', $2, $3::jsonb)`,
      [userId, userId, JSON.stringify({ via: "email", sectionIds: entries.rows.map((e) => e.section_id) })],
    );
  }
  return entries.rows.map((e) => e.section_id);
}

/**
 * The personal-Gmail fallback (decision 3): someone joining with the join code and a student ID
 * that matches a pending entry of that Section claims it. The entry's email stays on the
 * membership as roster_email, so staff see the mismatch.
 */
export async function claimRosterByStudentId(db: DatabaseClient | DatabasePool, userId: string, sectionId: string, studentId: string) {
  const entry = await db.query<{ id: string; section_id: string; student_id: string; name_th: string | null; name_en: string | null; email: string }>(
    `DELETE FROM section_roster_entries WHERE section_id = $1 AND student_id = $2
     RETURNING id, section_id, student_id, name_th, name_en, email::text`,
    [sectionId, studentId],
  );
  const row = entry.rows[0];
  if (!row) return false;
  await enrollFromRoster(db, userId, row);
  await db.query(
    `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
     VALUES ($1, 'roster.claimed', 'user', $2, $3::jsonb)`,
    [userId, userId, JSON.stringify({ via: "student_id", sectionIds: [sectionId], rosterEmail: row.email })],
  );
  return true;
}

async function enrollFromRoster(
  db: DatabaseClient | DatabasePool,
  userId: string,
  entry: { section_id: string; student_id: string; name_th: string | null; name_en: string | null; email: string },
) {
  await db.query(
    `INSERT INTO memberships (user_id, section_id, roles, student_id, roster_name_th, roster_name_en, roster_email)
     VALUES ($1, $2, ARRAY['student'], $3, $4, $5, $6)
     ON CONFLICT (user_id, section_id) DO UPDATE
     SET roles = CASE WHEN 'student' = ANY(memberships.roles) THEN memberships.roles
                      ELSE array_append(memberships.roles, 'student') END,
         student_id = EXCLUDED.student_id, roster_name_th = EXCLUDED.roster_name_th,
         roster_name_en = EXCLUDED.roster_name_en, roster_email = EXCLUDED.roster_email, updated_at = now()`,
    [userId, entry.section_id, entry.student_id, entry.name_th, entry.name_en, entry.email],
  );
}

export async function registerRosterRoutes(app: FastifyInstance, dependencies: { pool: DatabasePool; config: AppConfig }) {
  const { pool, config } = dependencies;

  // owner/teacher or a platform admin (decision 5): the roles that may grant `student`.
  async function authorize(request: FastifyRequest, reply: FastifyReply) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    const { sectionId } = request.params as { sectionId: string };
    if (!z.uuid().safeParse(sectionId).success) {
      await reply.code(400).send({ error: "INVALID_REQUEST" });
      return null;
    }
    const section = await pool.query<{ id: string; course_code: string; label: string }>(
      `SELECT section.id, course.code AS course_code, section.label
       FROM sections AS section JOIN courses AS course ON course.id = section.course_id
       WHERE section.id = $1`,
      [sectionId],
    );
    if (!section.rowCount) {
      await reply.code(404).send({ error: "SECTION_NOT_FOUND" });
      return null;
    }
    if (!user.isPlatformAdmin && !hasAnyRole(await getSectionRoles(pool, user.id, sectionId), ["owner", "teacher"])) {
      await reply.code(403).send({ error: "FORBIDDEN" });
      return null;
    }
    return { user, section: section.rows[0]! };
  }

  function readFile(body: z.infer<typeof importSchema>) {
    const bytes = Buffer.from(body.fileBase64, "base64");
    if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) return { error: "FILE_TOO_LARGE" as const };
    let decoded;
    try {
      decoded = decodeRosterBytes(bytes, body.encoding);
    } catch {
      return { error: "NOT_UTF8" as const };
    }
    const rows = parseCsv(decoded.text);
    const roster = readRoster(rows, body.mapping);
    // A few raw rows help the teacher tell columns apart when choosing a mapping.
    const sample = rows.slice(1, 4);
    if ("error" in roster) {
      if (roster.error === "EMPTY_FILE") return { error: roster.error };
      return { decoded, mappingProblem: roster, sample };
    }
    return { decoded, roster, sample };
  }

  async function plan(db: DatabaseClient | DatabasePool, sectionId: string, courseCode: string, fileRows: RosterFileRow[], chosenSection: string | null) {
    const fileSections = [...new Set(fileRows.map((r) => r.section).filter((s): s is string => Boolean(s)))].sort();
    const section = chosenSection ?? (fileSections.length === 1 ? fileSections[0]! : null);
    const members = await db.query<{ user_id: string; email: string; roles: string[]; student_id: string | null; roster_name_th: string | null; roster_name_en: string | null; display_name: string }>(
      `SELECT membership.user_id, app_user.email::text, membership.roles, membership.student_id,
              membership.roster_name_th, membership.roster_name_en, app_user.display_name
       FROM memberships AS membership JOIN users AS app_user ON app_user.id = membership.user_id
       WHERE membership.section_id = $1`,
      [sectionId],
    );
    const memberByEmail = new Map(members.rows.map((m) => [m.email.toLowerCase(), m]));
    const emails = [...new Set(fileRows.map((r) => r.email).filter(Boolean))];
    const accounts = await db.query<{ id: string; email: string }>("SELECT id, email::text FROM users WHERE email = ANY($1::citext[])", [emails]);
    const accountByEmail = new Map(accounts.rows.map((a) => [a.email.toLowerCase(), a.id]));
    const seenEmail = new Set<string>();
    const seenId = new Set<string>();
    const rows: PlannedRow[] = fileRows.map((r) => {
      const base = { line: r.line, studentId: r.studentId, email: r.email, nameTh: r.nameTh, nameEn: r.nameEn, studentIdConflict: null, userId: null, reason: null };
      if (!studentIdPattern.test(r.studentId)) return { ...base, status: "invalid", reason: "STUDENT_ID" };
      if (!emailSchema.safeParse(r.email).success) return { ...base, status: "invalid", reason: "EMAIL" };
      if (section && r.section && r.section !== section) return { ...base, status: "other_section", reason: r.section };
      if (seenEmail.has(r.email) || seenId.has(r.studentId)) return { ...base, status: "duplicate" };
      seenEmail.add(r.email);
      seenId.add(r.studentId);
      const member = memberByEmail.get(r.email);
      if (member) {
        if (!member.roles.includes("student")) return { ...base, status: "staff", userId: member.user_id };
        const conflict = member.student_id && member.student_id !== r.studentId ? member.student_id : null;
        const same = member.student_id === r.studentId && member.roster_name_th === r.nameTh && member.roster_name_en === r.nameEn;
        return { ...base, status: same ? "unchanged" : "update", userId: member.user_id, studentIdConflict: conflict };
      }
      const accountId = accountByEmail.get(r.email);
      if (accountId) return { ...base, status: "enroll", userId: accountId };
      return { ...base, status: "pending" };
    });
    const listed = new Set(rows.filter((r) => r.status !== "invalid").map((r) => r.email));
    // Decision 4: members missing from the file are reported, never removed here.
    const missing = members.rows
      .filter((m) => m.roles.includes("student") && !listed.has(m.email.toLowerCase()))
      .map((m) => ({ userId: m.user_id, displayName: m.roster_name_th ?? m.display_name, email: m.email, studentId: m.student_id }));
    const courseCodes = [...new Set(fileRows.map((r) => r.courseCode).filter((c): c is string => Boolean(c)))];
    return {
      fileSections,
      section,
      needsSectionChoice: fileSections.length > 1 && !section,
      courseCodeMismatch: courseCodes.length > 0 && !courseCodes.includes(courseCode),
      fileCourseCodes: courseCodes,
      rows,
      missing,
      counts: Object.fromEntries(
        (["enroll", "update", "unchanged", "pending", "invalid", "duplicate", "other_section", "staff"] as const).map((k) => [k, rows.filter((r) => r.status === k).length]),
      ),
    };
  }

  app.post("/api/sections/:sectionId/roster-import/preview", async (request, reply) => {
    const ctx = await authorize(request, reply);
    if (!ctx) return;
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const file = readFile(parsed.data);
    if ("error" in file) return reply.code(400).send({ error: file.error });
    if ("mappingProblem" in file && file.mappingProblem) {
      if (file.mappingProblem.error === "INVALID_MAPPING") return reply.code(400).send({ error: "INVALID_MAPPING" });
      // Student ID or email couldn't be placed: the teacher chooses the columns.
      return reply.send({
        encoding: file.decoded.encoding,
        unmappedBytes: file.decoded.unmapped,
        needsMapping: true,
        headers: file.mappingProblem.headers,
        suggestion: file.mappingProblem.suggestion,
        sample: file.sample,
      });
    }
    const result = await plan(pool, ctx.section.id, ctx.section.course_code, file.roster!.rows, parsed.data.section ?? null);
    return reply.send({
      encoding: file.decoded.encoding,
      unmappedBytes: file.decoded.unmapped,
      format: file.roster!.format,
      needsMapping: false,
      headers: file.roster!.headers,
      mapping: file.roster!.mapping,
      sample: file.sample,
      ...result,
    });
  });

  app.post("/api/sections/:sectionId/roster-import", async (request, reply) => {
    const ctx = await authorize(request, reply);
    if (!ctx) return;
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const file = readFile(parsed.data);
    if ("error" in file) return reply.code(400).send({ error: file.error });
    if ("mappingProblem" in file && file.mappingProblem) {
      return reply.code(400).send({ error: file.mappingProblem.error === "INVALID_MAPPING" ? "INVALID_MAPPING" : "MAPPING_REQUIRED" });
    }
    const roster = file.roster!;
    const outcome = await withTransaction(pool, async (client) => {
      const result = await plan(client, ctx.section.id, ctx.section.course_code, roster.rows, parsed.data.section ?? null);
      if (result.needsSectionChoice) return null;
      for (const row of result.rows) {
        if ((row.status === "enroll" || row.status === "update") && row.userId) {
          // A pending entry left from an earlier import for this person is now superseded.
          await client.query("DELETE FROM section_roster_entries WHERE section_id = $1 AND (email = $2 OR student_id = $3)", [
            ctx.section.id,
            row.email,
            row.studentId,
          ]);
          await enrollFromRoster(client, row.userId, {
            section_id: ctx.section.id,
            student_id: row.studentId,
            name_th: row.nameTh,
            name_en: row.nameEn,
            email: row.email,
          });
        } else if (row.status === "pending") {
          // The file is authoritative: a student ID now listed under another email moves with it.
          await client.query("DELETE FROM section_roster_entries WHERE section_id = $1 AND student_id = $2 AND email <> $3", [
            ctx.section.id,
            row.studentId,
            row.email,
          ]);
          await client.query(
            `INSERT INTO section_roster_entries (section_id, email, student_id, name_th, name_en, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (section_id, email) DO UPDATE
             SET student_id = EXCLUDED.student_id, name_th = EXCLUDED.name_th, name_en = EXCLUDED.name_en,
                 updated_at = now()`,
            [ctx.section.id, row.email, row.studentId, row.nameTh, row.nameEn, ctx.user.id],
          );
        }
      }
      await client.query(
        `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
         VALUES ($1, 'roster.imported', 'section', $2, $3::jsonb)`,
        [ctx.user.id, ctx.section.id, JSON.stringify({ format: roster.format, mapping: roster.mapping, encoding: file.decoded.encoding, section: result.section, counts: result.counts })],
      );
      return result;
    });
    if (!outcome) return reply.code(400).send({ error: "SECTION_CHOICE_REQUIRED" });
    return reply.send({ counts: outcome.counts, section: outcome.section });
  });

  app.get("/api/sections/:sectionId/roster-pending", async (request, reply) => {
    const ctx = await authorize(request, reply);
    if (!ctx) return;
    const result = await pool.query(
      `SELECT id, email::text, student_id, name_th, name_en, created_at
       FROM section_roster_entries WHERE section_id = $1 ORDER BY student_id`,
      [ctx.section.id],
    );
    return reply.send({ pending: result.rows });
  });

  app.delete("/api/sections/:sectionId/roster-pending/:entryId", async (request, reply) => {
    const ctx = await authorize(request, reply);
    if (!ctx) return;
    const { entryId } = request.params as { entryId: string };
    if (!z.uuid().safeParse(entryId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const deleted = await pool.query("DELETE FROM section_roster_entries WHERE id = $1 AND section_id = $2", [entryId, ctx.section.id]);
    if (!deleted.rowCount) return reply.code(404).send({ error: "ENTRY_NOT_FOUND" });
    return reply.send({ ok: true });
  });
}
