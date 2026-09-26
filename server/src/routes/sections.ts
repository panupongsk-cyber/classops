import { randomBytes } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { getSectionRoles, hasAnyRole } from "../authz.js";
import { claimRosterByStudentId } from "./roster.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";

// Learner-entered student ID (not treated as sensitive, but only ever shown to Section managers).
const studentIdSchema = z.string().trim().regex(/^[0-9A-Za-z-]{1,32}$/);
const joinSchema = z.object({ code: z.string().trim().min(1).max(64), studentId: studentIdSchema.optional() });
const myStudentIdSchema = z.object({ studentId: studentIdSchema.nullable() });

function generateJoinCode() {
  return randomBytes(6).toString("base64url");
}

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

export async function registerSectionRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  // Caller-scoped list for the v2 "My Sections" screen: every Section the caller holds a
  // Membership in, regardless of role. Avoids the alternative of fanning out GET /api/courses
  // then GET /api/courses/:courseId client-side, which would also expose the full course catalog
  // to every viewer just to find their own three Sections.
  app.get("/api/me/sections", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const result = await pool.query(
      `SELECT section.id AS section_id, section.term, section.label,
              course.id AS course_id, course.code AS course_code, course.title AS course_title,
              course.type AS course_type, membership.roles
       FROM memberships AS membership
       JOIN sections AS section ON section.id = membership.section_id
       JOIN courses AS course ON course.id = section.course_id
       WHERE membership.user_id = $1
       ORDER BY course.code, section.term, section.label`,
      [user.id],
    );
    return reply.send({ sections: result.rows });
  });

  app.get("/api/sections/:sectionId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    const roles = await getSectionRoles(pool, user.id, sectionId);
    if (!user.isPlatformAdmin && roles.length === 0) {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const result = await pool.query(
      `SELECT id, course_id, term, label, join_code, practice_enabled,
              (SELECT count(*)::int FROM practice_assignments AS pa WHERE pa.section_id = sections.id AND pa.status <> 'draft')
                AS practice_assignment_count
       FROM sections WHERE id = $1`,
      [sectionId],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    return reply.send({ section: result.rows[0] });
  });

  // Redeems a join code: grants the caller `student` only, never `teacher`/`ta`/`owner`.
  // Idempotent — redeeming an already-redeemed code does not duplicate the row or add roles.
  app.post("/api/sections/join", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const parsed = joinSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    const section = await pool.query<{ id: string }>(
      "SELECT id FROM sections WHERE join_code = $1",
      [parsed.data.code],
    );
    const sectionId = section.rows[0]?.id;
    if (!sectionId) return reply.code(400).send({ error: "INVALID_JOIN_CODE" });

    await pool.query(
      `INSERT INTO memberships (user_id, section_id, roles, student_id)
       VALUES ($1, $2, ARRAY['student'], $3)
       ON CONFLICT (user_id, section_id) DO UPDATE
       SET roles = CASE WHEN 'student' = ANY(memberships.roles) THEN memberships.roles
                        ELSE array_append(memberships.roles, 'student') END,
           student_id = COALESCE(EXCLUDED.student_id, memberships.student_id),
           updated_at = now()`,
      [user.id, sectionId, parsed.data.studentId ?? null],
    );
    // A joiner whose student ID matches a pending roster row of this Section claims it (the
    // personal-Gmail fallback); staff see the roster email differs from the account's.
    // It runs after the membership exists, so a roster failure must not fail the join itself.
    if (parsed.data.studentId) {
      try {
        await claimRosterByStudentId(pool, user.id, sectionId, parsed.data.studentId);
      } catch (error) {
        request.log.warn({ err: error, sectionId }, "roster claim by student ID failed");
      }
    }
    return reply.send({ sectionId, roles: ["student"] });
  });

  // The caller's own student ID in one Section: read, set, or clear (null).
  app.get("/api/sections/:sectionId/me/student-id", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    if (!z.uuid().safeParse(sectionId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const result = await pool.query<{ student_id: string | null }>(
      "SELECT student_id FROM memberships WHERE user_id = $1 AND section_id = $2",
      [user.id, sectionId],
    );
    if (!result.rowCount) return reply.code(403).send({ error: "FORBIDDEN" });
    return reply.send({ studentId: result.rows[0]?.student_id ?? null });
  });

  app.put("/api/sections/:sectionId/me/student-id", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    if (!z.uuid().safeParse(sectionId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const parsed = myStudentIdSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const result = await pool.query<{ student_id: string | null }>(
      `UPDATE memberships SET student_id = $3, updated_at = now()
       WHERE user_id = $1 AND section_id = $2 RETURNING student_id`,
      [user.id, sectionId, parsed.data.studentId],
    );
    if (!result.rowCount) return reply.code(403).send({ error: "FORBIDDEN" });
    return reply.send({ studentId: result.rows[0]?.student_id ?? null });
  });

  app.post("/api/sections/:sectionId/join-code/regenerate", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    const roles = await getSectionRoles(pool, user.id, sectionId);
    if (!user.isPlatformAdmin && !hasAnyRole(roles, ["owner", "teacher"])) {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const joinCode = generateJoinCode();
    const result = await pool.query(
      "UPDATE sections SET join_code = $2, updated_at = now() WHERE id = $1 RETURNING join_code",
      [sectionId, joinCode],
    );
    if (!result.rowCount) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    return reply.send({ joinCode: result.rows[0]?.join_code });
  });
}
