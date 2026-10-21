import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { type AuthenticatedUser, canManageSessions, getSectionRoles, type MembershipRole } from "../authz.js";
import {
  CodeRunnerError,
  createPistonRunner,
  MAX_CODE_CHARS,
  MAX_IO_CHARS,
  MAX_TESTS,
  type RunCode,
} from "../code-runner.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";
import { sessionRateLimitKey } from "../rate-limit-key.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const testSchema = z.object({
  name: z.string().trim().max(200).optional(),
  stdin: z.string().max(MAX_IO_CHARS),
  expected_stdout: z.string().max(MAX_IO_CHARS),
});
const statusSchema = z.enum(["draft", "open", "closed"]);
const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().max(10_000).default(""),
  starter_code: z.string().max(MAX_CODE_CHARS).default(""),
  tests: z.array(testSchema).min(1).max(MAX_TESTS),
  status: statusSchema.default("draft"),
});
const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    prompt: z.string().max(10_000),
    starter_code: z.string().max(MAX_CODE_CHARS),
    tests: z.array(testSchema).min(1).max(MAX_TESTS),
    status: statusSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "at least one field is required" });
const codeSchema = z.object({ code: z.string().max(MAX_CODE_CHARS) });

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

interface ExerciseRow {
  id: string;
  section_id: string;
  title: string;
  prompt: string;
  starter_code: string;
  tests: Array<{ name?: string; stdin: string; expected_stdout: string }>;
  status: "draft" | "open" | "closed";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const EXERCISE_COLUMNS =
  "id, section_id, title, prompt, starter_code, tests, status, created_by, created_at, updated_at";

export async function registerCodeExerciseRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig; runCode?: RunCode },
) {
  const { pool, config } = dependencies;
  const runCode = dependencies.runCode ?? createPistonRunner({ pistonUrl: config.pistonUrl ?? null });
  const perUser = {
    config: {
      rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: sessionRateLimitKey(pool, config) },
    },
  };
  const isManager = (user: AuthenticatedUser, roles: MembershipRole[]) =>
    user.isPlatformAdmin || canManageSessions(roles);

  async function sectionExists(sectionId: string) {
    if (!UUID_RE.test(sectionId)) return false;
    const result = await pool.query("SELECT 1 FROM sections WHERE id = $1", [sectionId]);
    return Boolean(result.rowCount);
  }

  async function loadExercise(id: string) {
    if (!UUID_RE.test(id)) return null;
    const result = await pool.query<ExerciseRow>(`SELECT ${EXERCISE_COLUMNS} FROM code_exercises WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  }

  /** Loads the exercise and the caller's standing; replies and returns null on any refusal. */
  async function access(request: FastifyRequest, reply: FastifyReply) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    const { id } = request.params as { id: string };
    const exercise = await loadExercise(id);
    if (!exercise) {
      await reply.code(404).send({ error: "CODE_EXERCISE_NOT_FOUND" });
      return null;
    }
    const roles = await getSectionRoles(pool, user.id, exercise.section_id);
    if (!user.isPlatformAdmin && roles.length === 0) {
      await reply.code(403).send({ error: "FORBIDDEN" });
      return null;
    }
    const manager = isManager(user, roles);
    if (!manager && exercise.status === "draft") {
      await reply.code(404).send({ error: "CODE_EXERCISE_NOT_FOUND" });
      return null;
    }
    return { user, exercise, manager };
  }

  async function execute(reply: FastifyReply, code: string, exercise: ExerciseRow) {
    try {
      return await runCode(code, exercise.tests);
    } catch (error) {
      if (error instanceof CodeRunnerError) {
        await reply.code(503).send({ error: error.code });
        return null;
      }
      throw error;
    }
  }

  app.get("/api/sections/:sectionId/code-exercises", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    if (!(await sectionExists(sectionId))) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    const roles = await getSectionRoles(pool, user.id, sectionId);
    if (!user.isPlatformAdmin && roles.length === 0) return reply.code(403).send({ error: "FORBIDDEN" });
    const manager = isManager(user, roles);
    const result = await pool.query(
      `SELECT exercise.id, exercise.section_id, exercise.title, exercise.status, exercise.created_at,
              exercise.updated_at, jsonb_array_length(exercise.tests) AS test_count,
              mine.passed_count AS my_passed_count, mine.total_count AS my_total_count,
              mine.submitted_at AS my_submitted_at,
              (SELECT count(*)::int FROM code_submissions WHERE exercise_id = exercise.id) AS submission_count
       FROM code_exercises AS exercise
       LEFT JOIN code_submissions AS mine ON mine.exercise_id = exercise.id AND mine.user_id = $2
       WHERE exercise.section_id = $1 AND ($3::boolean OR exercise.status <> 'draft')
       ORDER BY exercise.created_at DESC`,
      [sectionId, user.id, manager],
    );
    return reply.send({ exercises: result.rows, canManage: manager });
  });

  app.post("/api/sections/:sectionId/code-exercises", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    if (!(await sectionExists(sectionId))) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    const roles = await getSectionRoles(pool, user.id, sectionId);
    if (!isManager(user, roles)) return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const { title, prompt, starter_code, tests, status } = parsed.data;
    const result = await pool.query<ExerciseRow>(
      `INSERT INTO code_exercises (section_id, title, prompt, starter_code, tests, status, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING ${EXERCISE_COLUMNS}`,
      [sectionId, title, prompt, starter_code, JSON.stringify(tests), status, user.id],
    );
    return reply.code(201).send({ exercise: result.rows[0] });
  });

  app.get("/api/code-exercises/:id", async (request, reply) => {
    const found = await access(request, reply);
    if (!found) return;
    const mine = await pool.query(
      `SELECT code, results, passed_count, total_count, submitted_at FROM code_submissions
       WHERE exercise_id = $1 AND user_id = $2`,
      [found.exercise.id, found.user.id],
    );
    return reply.send({ exercise: found.exercise, canManage: found.manager, mySubmission: mine.rows[0] ?? null });
  });

  app.patch("/api/code-exercises/:id", async (request, reply) => {
    const found = await access(request, reply);
    if (!found) return;
    if (!found.manager) return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const next = { ...found.exercise, ...parsed.data };
    const result = await pool.query<ExerciseRow>(
      `UPDATE code_exercises SET title = $2, prompt = $3, starter_code = $4, tests = $5::jsonb, status = $6,
              updated_at = now()
       WHERE id = $1 RETURNING ${EXERCISE_COLUMNS}`,
      [found.exercise.id, next.title, next.prompt, next.starter_code, JSON.stringify(next.tests), next.status],
    );
    return reply.send({ exercise: result.rows[0] });
  });

  app.post("/api/code-exercises/:id/run", perUser, async (request, reply) => {
    const found = await access(request, reply);
    if (!found) return;
    const parsed = codeSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    if (!found.manager && found.exercise.status !== "open") {
      return reply.code(409).send({ error: "CODE_EXERCISE_NOT_OPEN" });
    }
    const outcome = await execute(reply, parsed.data.code, found.exercise);
    if (!outcome) return;
    return reply.send(outcome);
  });

  app.post("/api/code-exercises/:id/submissions", perUser, async (request, reply) => {
    const found = await access(request, reply);
    if (!found) return;
    const parsed = codeSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    if (found.exercise.status !== "open") return reply.code(409).send({ error: "CODE_EXERCISE_NOT_OPEN" });
    const outcome = await execute(reply, parsed.data.code, found.exercise);
    if (!outcome) return;
    // Identity is always the authenticated caller. Resubmitting replaces the latest submission.
    const result = await pool.query(
      `INSERT INTO code_submissions (exercise_id, user_id, code, results, passed_count, total_count)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (exercise_id, user_id) DO UPDATE
       SET code = EXCLUDED.code, results = EXCLUDED.results, passed_count = EXCLUDED.passed_count,
           total_count = EXCLUDED.total_count, submitted_at = now()
       RETURNING code, results, passed_count, total_count, submitted_at`,
      [
        found.exercise.id,
        found.user.id,
        parsed.data.code,
        JSON.stringify(outcome.results),
        outcome.passedCount,
        outcome.totalCount,
      ],
    );
    return reply.send({ submission: result.rows[0], ...outcome });
  });

  app.get("/api/code-exercises/:id/submissions", async (request, reply) => {
    const found = await access(request, reply);
    if (!found) return;
    const result = await pool.query(
      `SELECT app_user.id AS user_id, app_user.email::text, app_user.display_name,
              submission.code, submission.results, submission.passed_count, submission.total_count,
              submission.submitted_at
       FROM code_submissions AS submission
       JOIN users AS app_user ON app_user.id = submission.user_id
       WHERE submission.exercise_id = $1 AND ($2::boolean OR submission.user_id = $3)
       ORDER BY app_user.display_name, submission.submitted_at`,
      [found.exercise.id, found.manager, found.user.id],
    );
    return reply.send({ submissions: result.rows });
  });
}
