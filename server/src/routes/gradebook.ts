import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { canManageSessions, getSectionRoles } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { computeGrades } from "../gradebook.js";

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
});
const scoreSchema = z.object({ pointsEarned: z.number().min(0) });
const bulkScoreSchema = z.object({
  scores: z.array(z.object({ userId: z.uuid(), pointsEarned: z.number().min(0) })).min(1),
});

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
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
}

async function getAssignment(pool: DatabasePool, assignmentId: string) {
  const result = await pool.query<AssignmentRow & { section_id: string }>(
    `SELECT assignment.id, assignment.category_id, assignment.name, assignment.max_points,
            category.section_id
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
export async function loadGradebookInputs(pool: DatabasePool, sectionId: string) {
  const categoriesResult = await pool.query<CategoryRow>(
    "SELECT id, section_id, name, weight FROM categories WHERE section_id = $1 ORDER BY created_at",
    [sectionId],
  );
  const categories = categoriesResult.rows;
  const categoryIds = categories.map((category) => category.id);

  const assignmentsResult = categoryIds.length
    ? await pool.query<AssignmentRow>(
        "SELECT id, category_id, name, max_points FROM assignments WHERE category_id = ANY($1) ORDER BY created_at",
        [categoryIds],
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

  const studentsResult = await pool.query<{ user_id: string; email: string; display_name: string }>(
    `SELECT app_user.id AS user_id, app_user.email::text, app_user.display_name
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
      `SELECT assignment.id, assignment.category_id, assignment.name, assignment.max_points
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
      "INSERT INTO assignments (category_id, name, max_points) VALUES ($1, $2, $3) RETURNING id, category_id, name, max_points",
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
      `UPDATE assignments SET name = COALESCE($2, name), max_points = COALESCE($3, max_points), updated_at = now()
       WHERE id = $1 RETURNING id, category_id, name, max_points`,
      [assignmentId, parsed.data.name ?? null, parsed.data.maxPoints ?? null],
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

    const header = [
      "Student Name",
      "Student Email",
      ...assignments.map((assignment) => {
        const category = categoryById.get(assignment.category_id);
        return `${assignment.name} (${category?.name ?? ""})`;
      }),
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
        ...assignmentCells,
        ...categoryCells,
        formatNumber(grade?.finalGrade ?? null),
      ];
    });

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvEscape(String(cell))).join(","))
      .join("\n");
    return reply.type("text/csv; charset=utf-8").send(csv);
  });
}
