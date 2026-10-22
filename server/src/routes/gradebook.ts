import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { canManageSessions, getSectionRoles } from "../authz.js";
import type { AppConfig } from "../config.js";
import { toCsv } from "../csv.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";
import { withTransaction, type DatabaseClient } from "../db.js";
import { computeGrades } from "../gradebook.js";
import { assignmentHeader, planGradebookImport } from "../gradebook-import.js";
import { decodeRosterBytes, parseCsvRecords } from "../roster-file.js";

const categorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  weight: z.number().positive(),
});
const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  weight: z.number().positive().optional(),
});
const assignmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  maxPoints: z.number().positive(),
});
const assignmentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  maxPoints: z.number().positive().optional(),
  released: z.boolean().optional(),
});
const scoreSchema = z.object({ pointsEarned: z.number().min(0) });
const bulkScoreSchema = z.object({
  scores: z.array(z.object({ userId: z.uuid(), pointsEarned: z.number().min(0) })).min(1),
});
// Gradebook CSV import (#2437): the file is sent as base64 twice -- for the preview and with the
// confirmation -- and both run the same plan, as the roster import does.
const MAX_IMPORT_BYTES = 512 * 1024;
const importSchema = z.object({
  fileBase64: z.string().min(1).max(Math.ceil((MAX_IMPORT_BYTES * 4) / 3) + 8),
  encoding: z.enum(["auto", "utf-8", "tis-620"]).default("auto"),
});

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

function formatNumber(value: number | undefined | null) {
  return value === undefined || value === null ? "" : value.toFixed(2);
}

interface CategoryRow {
  id: string;
  section_id: string;
  name: string;
  weight: string;
}

async function getCategory(pool: DatabasePool, categoryId: string) {
  const result = await pool.query<CategoryRow>(
    "SELECT id, section_id, name, weight FROM categories WHERE id = $1",
    [categoryId],
  );
  return result.rows[0] ?? null;
}

interface AssignmentRow {
  id: string;
  category_id: string;
  name: string;
  max_points: string;
  released_at: Date | null;
}

async function getAssignment(pool: DatabasePool, assignmentId: string) {
  const result = await pool.query<AssignmentRow & { section_id: string }>(
    `SELECT assignment.id, assignment.category_id, assignment.name, assignment.max_points,
            assignment.released_at, category.section_id
     FROM assignments AS assignment
     JOIN categories AS category ON category.id = assignment.category_id
     WHERE assignment.id = $1`,
    [assignmentId],
  );
  return result.rows[0] ?? null;
}

// Fetches everything computeGrades() needs for one Section in three queries, and the
// student/ta roster to compute for -- shared by both the JSON gradebook view and the CSV export
// so their numbers can never drift apart.
// Exported for reuse by Phase 2b-4's Stats Dashboard (src/routes/stats.ts), so its grade
// computation is never a second, potentially-drifting copy of this one.
// `releasedOnly` restricts the computation to released Assignments, for any view a student sees
// of their own grade (#2436), so an unreleased score never reaches them through a total.
export async function loadGradebookInputs(
  pool: DatabasePool,
  sectionId: string,
  options: { releasedOnly?: boolean } = {},
) {
  const categoriesResult = await pool.query<CategoryRow>(
    "SELECT id, section_id, name, weight FROM categories WHERE section_id = $1 ORDER BY created_at",
    [sectionId],
  );
  const categories = categoriesResult.rows;
  const categoryIds = categories.map((category) => category.id);

  const assignmentsResult = categoryIds.length
    ? await pool.query<AssignmentRow>(
        `SELECT id, category_id, name, max_points, released_at FROM assignments
         WHERE category_id = ANY($1) AND ($2::boolean IS NOT TRUE OR released_at IS NOT NULL)
         ORDER BY created_at`,
        [categoryIds, options.releasedOnly ?? false],
      )
    : { rows: [] as AssignmentRow[] };
  const assignments = assignmentsResult.rows;
  const assignmentIds = assignments.map((assignment) => assignment.id);

  const scoresResult = assignmentIds.length
    ? await pool.query<{ assignment_id: string; user_id: string; points_earned: string }>(
        "SELECT assignment_id, user_id, points_earned FROM scores WHERE assignment_id = ANY($1)",
        [assignmentIds],
      )
    : { rows: [] as { assignment_id: string; user_id: string; points_earned: string }[] };

  const studentsResult = await pool.query<{
    user_id: string;
    email: string;
    display_name: string;
    student_id: string | null;
  }>(
    `SELECT app_user.id AS user_id, app_user.email::text, app_user.display_name, membership.student_id
     FROM memberships AS membership
     JOIN users AS app_user ON app_user.id = membership.user_id
     WHERE membership.section_id = $1
       AND membership.roles && ARRAY['student', 'ta']::text[]
     ORDER BY app_user.display_name`,
    [sectionId],
  );

  const grades = computeGrades(
    categories.map((category) => ({ id: category.id, weight: Number(category.weight) })),
    assignments.map((assignment) => ({
      id: assignment.id,
      categoryId: assignment.category_id,
      maxPoints: Number(assignment.max_points),
    })),
    scoresResult.rows.map((score) => ({
      assignmentId: score.assignment_id,
      userId: score.user_id,
      pointsEarned: Number(score.points_earned),
    })),
    studentsResult.rows.map((student) => student.user_id),
  );
  const gradeByUserId = new Map(grades.map((grade) => [grade.userId, grade]));
  const scoreByKey = new Map(
    scoresResult.rows.map((score) => [
      `${score.assignment_id}:${score.user_id}`,
      Number(score.points_earned),
    ]),
  );

  return { categories, assignments, students: studentsResult.rows, gradeByUserId, scoreByKey };
}

export async function registerGradebookRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  async function requireManager(request: FastifyRequest, reply: FastifyReply, sectionId: string) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageSessions(roles)) {
        await reply.code(403).send({ error: "FORBIDDEN" });
        return null;
      }
    }
    return user;
  }

  app.get("/api/sections/:sectionId/categories", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    if (!(await requireManager(request, reply, sectionId))) return;
    const result = await pool.query(
      "SELECT id, name, weight FROM categories WHERE section_id = $1 ORDER BY created_at",
      [sectionId],
    );
    return reply.send({ categories: result.rows });
  });

  app.post("/api/sections/:sectionId/categories", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    if (!(await requireManager(request, reply, sectionId))) return;
    const parsed = categorySchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    const result = await pool.query(
      "INSERT INTO categories (section_id, name, weight) VALUES ($1, $2, $3) RETURNING id, name, weight",
      [sectionId, parsed.data.name, parsed.data.weight],
    );
    return reply.code(201).send({ category: result.rows[0] });
  });

  app.patch("/api/categories/:categoryId", async (request, reply) => {
    const { categoryId } = request.params as { categoryId: string };
    const category = await getCategory(pool, categoryId);
    if (!category) return reply.code(404).send({ error: "CATEGORY_NOT_FOUND" });
    if (!(await requireManager(request, reply, category.section_id))) return;
    const parsed = categoryUpdateSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    const result = await pool.query(
      `UPDATE categories SET name = COALESCE($2, name), weight = COALESCE($3, weight), updated_at = now()
       WHERE id = $1 RETURNING id, name, weight`,
      [categoryId, parsed.data.name ?? null, parsed.data.weight ?? null],
    );
    return reply.send({ category: result.rows[0] });
  });

  app.delete("/api/categories/:categoryId", async (request, reply) => {
    const { categoryId } = request.params as { categoryId: string };
    const category = await getCategory(pool, categoryId);
    if (!category) return reply.code(404).send({ error: "CATEGORY_NOT_FOUND" });
    if (!(await requireManager(request, reply, category.section_id))) return;
    await pool.query("DELETE FROM categories WHERE id = $1", [categoryId]);
    return reply.send({ deleted: true });
  });

  app.get("/api/sections/:sectionId/assignments", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    if (!(await requireManager(request, reply, sectionId))) return;
    const result = await pool.query(
      `SELECT assignment.id, assignment.category_id, assignment.name, assignment.max_points,
              assignment.released_at
       FROM assignments AS assignment
       JOIN categories AS category ON category.id = assignment.category_id
       WHERE category.section_id = $1
       ORDER BY assignment.created_at`,
      [sectionId],
    );
    return reply.send({ assignments: result.rows });
  });

  app.post("/api/categories/:categoryId/assignments", async (request, reply) => {
    const { categoryId } = request.params as { categoryId: string };
    const category = await getCategory(pool, categoryId);
    if (!category) return reply.code(404).send({ error: "CATEGORY_NOT_FOUND" });
    if (!(await requireManager(request, reply, category.section_id))) return;
    const parsed = assignmentSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    const result = await pool.query(
      "INSERT INTO assignments (category_id, name, max_points) VALUES ($1, $2, $3) RETURNING id, category_id, name, max_points, released_at",
      [categoryId, parsed.data.name, parsed.data.maxPoints],
    );
    return reply.code(201).send({ assignment: result.rows[0] });
  });

  app.patch("/api/assignments/:assignmentId", async (request, reply) => {
    const { assignmentId } = request.params as { assignmentId: string };
    const assignment = await getAssignment(pool, assignmentId);
    if (!assignment) return reply.code(404).send({ error: "ASSIGNMENT_NOT_FOUND" });
    if (!(await requireManager(request, reply, assignment.section_id))) return;
    const parsed = assignmentUpdateSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    const result = await pool.query(
      `UPDATE assignments SET name = COALESCE($2, name), max_points = COALESCE($3, max_points),
              released_at = CASE WHEN $4::boolean IS NULL THEN released_at
                                 WHEN $4 THEN COALESCE(released_at, now())
                                 ELSE NULL END,
              updated_at = now()
       WHERE id = $1 RETURNING id, category_id, name, max_points, released_at`,
      [assignmentId, parsed.data.name ?? null, parsed.data.maxPoints ?? null, parsed.data.released ?? null],
    );
    return reply.send({ assignment: result.rows[0] });
  });

  app.delete("/api/assignments/:assignmentId", async (request, reply) => {
    const { assignmentId } = request.params as { assignmentId: string };
    const assignment = await getAssignment(pool, assignmentId);
    if (!assignment) return reply.code(404).send({ error: "ASSIGNMENT_NOT_FOUND" });
    if (!(await requireManager(request, reply, assignment.section_id))) return;
    await pool.query("DELETE FROM assignments WHERE id = $1", [assignmentId]);
    return reply.send({ deleted: true });
  });

  app.get("/api/assignments/:assignmentId/scores", async (request, reply) => {
    const { assignmentId } = request.params as { assignmentId: string };
    const assignment = await getAssignment(pool, assignmentId);
    if (!assignment) return reply.code(404).send({ error: "ASSIGNMENT_NOT_FOUND" });
    if (!(await requireManager(request, reply, assignment.section_id))) return;
    const result = await pool.query(
      `SELECT app_user.id AS user_id, app_user.email::text, app_user.display_name, score.points_earned
       FROM scores AS score
       JOIN users AS app_user ON app_user.id = score.user_id
       WHERE score.assignment_id = $1
       ORDER BY app_user.display_name`,
      [assignmentId],
    );
    return reply.send({ scores: result.rows });
  });

  // Only owner/teacher/ta ever write a Score -- unlike check-in/Exit-Ticket, there is no
  // "resubmission" identity concern to guard against, so re-entering a score is a plain upsert.
  app.post("/api/assignments/:assignmentId/scores/:userId", async (request, reply) => {
    const { assignmentId, userId } = request.params as { assignmentId: string; userId: string };
    const assignment = await getAssignment(pool, assignmentId);
    if (!assignment) return reply.code(404).send({ error: "ASSIGNMENT_NOT_FOUND" });
    if (!(await requireManager(request, reply, assignment.section_id))) return;
    const parsed = scoreSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    const roles = await getSectionRoles(pool, userId, assignment.section_id);
    if (roles.length === 0) return reply.code(400).send({ error: "NOT_A_SECTION_MEMBER" });

    const result = await pool.query(
      `INSERT INTO scores (assignment_id, user_id, points_earned) VALUES ($1, $2, $3)
       ON CONFLICT (assignment_id, user_id) DO UPDATE
       SET points_earned = EXCLUDED.points_earned, updated_at = now()
       RETURNING user_id, points_earned`,
      [assignmentId, userId, parsed.data.pointsEarned],
    );
    return reply.send({ score: result.rows[0] });
  });

  // Submits a whole Assignment's worth of scores atomically -- a partial failure (e.g. one
  // userId that isn't actually a Section member) rejects the entire batch rather than leaving
  // the gradebook half-updated.
  app.post("/api/assignments/:assignmentId/scores/bulk", async (request, reply) => {
    const { assignmentId } = request.params as { assignmentId: string };
    const assignment = await getAssignment(pool, assignmentId);
    if (!assignment) return reply.code(404).send({ error: "ASSIGNMENT_NOT_FOUND" });
    if (!(await requireManager(request, reply, assignment.section_id))) return;
    const parsed = bulkScoreSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    try {
      const scores = await withTransaction(pool, async (client) => {
        const written = [];
        for (const entry of parsed.data.scores) {
          const roles = await getSectionRoles(pool, entry.userId, assignment.section_id);
          if (roles.length === 0) {
            throw Object.assign(new Error("not a section member"), {
              code: "NOT_A_SECTION_MEMBER",
              userId: entry.userId,
            });
          }
          const result = await client.query(
            `INSERT INTO scores (assignment_id, user_id, points_earned) VALUES ($1, $2, $3)
             ON CONFLICT (assignment_id, user_id) DO UPDATE
             SET points_earned = EXCLUDED.points_earned, updated_at = now()
             RETURNING user_id, points_earned`,
            [assignmentId, entry.userId, entry.pointsEarned],
          );
          written.push(result.rows[0]);
        }
        return written;
      });
      return reply.send({ scores });
    } catch (error) {
      if ((error as { code?: string }).code === "NOT_A_SECTION_MEMBER") {
        return reply.code(400).send({
          error: "NOT_A_SECTION_MEMBER",
          userId: (error as { userId?: string }).userId,
        });
      }
      throw error;
    }
  });

  app.get("/api/sections/:sectionId/gradebook", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    if (!(await requireManager(request, reply, sectionId))) return;
    const { categories, students, gradeByUserId } = await loadGradebookInputs(pool, sectionId);

    const rows = students.map((student) => {
      const grade = gradeByUserId.get(student.user_id);
      const categoryPercentages: Record<string, number> = {};
      for (const category of categories) {
        const percent = grade?.categoryPercentages.get(category.id);
        if (percent !== undefined) categoryPercentages[category.id] = percent;
      }
      return {
        userId: student.user_id,
        email: student.email,
        displayName: student.display_name,
        categoryPercentages,
        finalGrade: grade?.finalGrade ?? null,
      };
    });
    return reply.send({ categories, students: rows });
  });

  app.get("/api/sections/:sectionId/gradebook/export", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    if (!(await requireManager(request, reply, sectionId))) return;
    const { categories, assignments, students, gradeByUserId, scoreByKey } =
      await loadGradebookInputs(pool, sectionId);
    const categoryById = new Map(categories.map((category) => [category.id, category]));

    // The import (#2437) reads this same shape back: Student ID and Student Email identify the
    // row, and each Assignment column is found again through assignmentHeader().
    const header = [
      "Student Name",
      "Student Email",
      "Student ID",
      ...assignments.map((assignment) =>
        assignmentHeader(assignment.name, categoryById.get(assignment.category_id)?.name ?? ""),
      ),
      ...categories.map((category) => `${category.name} %`),
      "Final Grade",
    ];

    const rows = students.map((student) => {
      const grade = gradeByUserId.get(student.user_id);
      const assignmentCells = assignments.map((assignment) => {
        const value = scoreByKey.get(`${assignment.id}:${student.user_id}`);
        return formatNumber(value);
      });
      const categoryCells = categories.map((category) =>
        formatNumber(grade?.categoryPercentages.get(category.id)),
      );
      return [
        student.display_name,
        student.email,
        student.student_id ?? "",
        ...assignmentCells,
        ...categoryCells,
        formatNumber(grade?.finalGrade ?? null),
      ];
    });

    const csv = toCsv([header, ...rows]);
    return reply.type("text/csv; charset=utf-8").send(csv);
  });

  // Everything the import plan needs, read through the given connection so the confirm step can
  // re-plan inside its transaction.
  async function loadImportInputs(db: DatabasePool | DatabaseClient, sectionId: string) {
    const assignments = await db.query<{ id: string; name: string; max_points: string; category_name: string }>(
      `SELECT assignment.id, assignment.name, assignment.max_points, category.name AS category_name
       FROM assignments AS assignment
       JOIN categories AS category ON category.id = assignment.category_id
       WHERE category.section_id = $1
       ORDER BY assignment.created_at`,
      [sectionId],
    );
    const categories = await db.query<{ name: string }>("SELECT name FROM categories WHERE section_id = $1", [sectionId]);
    const members = await db.query<{
      user_id: string;
      email: string;
      display_name: string;
      student_id: string | null;
      roster_email: string | null;
      roster_student_id: string | null;
      roles: string[];
    }>(
      `SELECT app_user.id AS user_id, app_user.email::text, app_user.display_name, membership.student_id,
              membership.roster_email::text, membership.roster_student_id, membership.roles
       FROM memberships AS membership
       JOIN users AS app_user ON app_user.id = membership.user_id
       WHERE membership.section_id = $1
       ORDER BY app_user.display_name`,
      [sectionId],
    );
    const assignmentIds = assignments.rows.map((assignment) => assignment.id);
    const scores = assignmentIds.length
      ? await db.query<{ assignment_id: string; user_id: string; points_earned: string }>(
          "SELECT assignment_id, user_id, points_earned FROM scores WHERE assignment_id = ANY($1)",
          [assignmentIds],
        )
      : { rows: [] as { assignment_id: string; user_id: string; points_earned: string }[] };
    return {
      assignments: assignments.rows.map((assignment) => ({
        id: assignment.id,
        name: assignment.name,
        categoryName: assignment.category_name,
        maxPoints: Number(assignment.max_points),
      })),
      categoryNames: categories.rows.map((category) => category.name),
      members: members.rows.map((member) => ({
        userId: member.user_id,
        email: member.email,
        displayName: member.display_name,
        studentId: member.student_id,
        rosterEmail: member.roster_email,
        rosterStudentId: member.roster_student_id,
        roles: member.roles,
      })),
      scores: new Map(
        scores.rows.map((score) => [`${score.assignment_id}:${score.user_id}`, Number(score.points_earned)]),
      ),
    };
  }

  function readImportFile(body: z.infer<typeof importSchema>) {
    const bytes = Buffer.from(body.fileBase64, "base64");
    if (bytes.length === 0) return { error: "EMPTY_FILE" as const };
    if (bytes.length > MAX_IMPORT_BYTES) return { error: "FILE_TOO_LARGE" as const };
    let decoded;
    try {
      decoded = decodeRosterBytes(bytes, body.encoding);
    } catch {
      return { error: "INVALID_ENCODING" as const };
    }
    return { decoded, records: parseCsvRecords(decoded.text) };
  }

  app.post("/api/sections/:sectionId/gradebook/import/preview", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    if (!z.uuid().safeParse(sectionId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    if (!(await requireManager(request, reply, sectionId))) return;
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const file = readImportFile(parsed.data);
    if ("error" in file) return reply.code(400).send({ error: file.error });
    const plan = planGradebookImport({ records: file.records, ...(await loadImportInputs(pool, sectionId)) });
    if (plan.error) return reply.code(400).send({ error: plan.error, headers: plan.headers });
    return reply.send({ encoding: file.decoded.encoding, unmappedBytes: file.decoded.unmapped, ...plan });
  });

  app.post("/api/sections/:sectionId/gradebook/import", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    if (!z.uuid().safeParse(sectionId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const user = await requireManager(request, reply, sectionId);
    if (!user) return;
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const file = readImportFile(parsed.data);
    if ("error" in file) return reply.code(400).send({ error: file.error });

    // Re-planned inside the transaction from the file and the current scores: the client never
    // supplies the cells to write.
    const plan = await withTransaction(pool, async (client) => {
      const result = planGradebookImport({ records: file.records, ...(await loadImportInputs(client, sectionId)) });
      if (result.error) return result;
      for (const row of result.rows) {
        if (row.status !== "change" || !row.userId) continue;
        for (const change of row.changes) {
          // points_earned only, like the bulk entry: a later activity/practice sync then sees an
          // imported value over a synced cell as a hand edit.
          await client.query(
            `INSERT INTO scores (assignment_id, user_id, points_earned) VALUES ($1, $2, $3)
             ON CONFLICT (assignment_id, user_id) DO UPDATE
             SET points_earned = EXCLUDED.points_earned, updated_at = now()`,
            [change.assignmentId, row.userId, change.to],
          );
        }
      }
      await client.query(
        `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
         VALUES ($1, 'gradebook.imported', 'section', $2, $3::jsonb)`,
        [
          user.id,
          sectionId,
          JSON.stringify({
            encoding: file.decoded.encoding,
            counts: result.counts,
            columns: result.matchedColumns.map((column) => column.header),
            unknownColumns: result.unknownColumns,
          }),
        ],
      );
      return result;
    });
    if (plan.error) return reply.code(400).send({ error: plan.error, headers: plan.headers });
    return reply.send({ counts: plan.counts });
  });

  // A member's own grades (#2436). Only released Assignments are visible, and the category
  // percentages and final grade are computed from released Assignments alone -- otherwise an
  // unreleased score could be worked back out of the totals. Always scoped to the caller: there
  // is no userId parameter, so one student can never ask for another's grades.
  app.get("/api/sections/:sectionId/my-grades", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const roles = await getSectionRoles(pool, user.id, sectionId);
    if (roles.length === 0) return reply.code(403).send({ error: "FORBIDDEN" });

    const categoriesResult = await pool.query<CategoryRow>(
      "SELECT id, section_id, name, weight FROM categories WHERE section_id = $1 ORDER BY created_at",
      [sectionId],
    );
    const categories = categoriesResult.rows;
    const assignmentsResult = await pool.query<AssignmentRow & { points_earned: string | null }>(
      `SELECT assignment.id, assignment.category_id, assignment.name, assignment.max_points,
              assignment.released_at, score.points_earned
       FROM assignments AS assignment
       JOIN categories AS category ON category.id = assignment.category_id
       LEFT JOIN scores AS score ON score.assignment_id = assignment.id AND score.user_id = $2
       WHERE category.section_id = $1 AND assignment.released_at IS NOT NULL
       ORDER BY assignment.created_at`,
      [sectionId, user.id],
    );
    const assignments = assignmentsResult.rows;

    const [grade] = computeGrades(
      categories.map((category) => ({ id: category.id, weight: Number(category.weight) })),
      assignments.map((assignment) => ({
        id: assignment.id,
        categoryId: assignment.category_id,
        maxPoints: Number(assignment.max_points),
      })),
      assignments
        .filter((assignment) => assignment.points_earned !== null)
        .map((assignment) => ({
          assignmentId: assignment.id,
          userId: user.id,
          pointsEarned: Number(assignment.points_earned),
        })),
      [user.id],
    );

    return reply.send({
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        weight: Number(category.weight),
        percent: grade?.categoryPercentages.get(category.id) ?? null,
      })),
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        categoryId: assignment.category_id,
        name: assignment.name,
        maxPoints: Number(assignment.max_points),
        pointsEarned: assignment.points_earned === null ? null : Number(assignment.points_earned),
      })),
      finalGrade: grade?.finalGrade ?? null,
    });
  });
}
