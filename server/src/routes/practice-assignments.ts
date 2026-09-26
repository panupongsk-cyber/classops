import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { canManageSessions, getSectionRoles, hasAnyRole } from "../authz.js";
import type { AppConfig } from "../config.js";
import { toCsv } from "../csv.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { sessionRateLimitKey } from "../rate-limit-key.js";

// Practice assignments, Phase 3a (PS-TASK-20260926-785). A teacher sets an assignment for a
// Section: a whole exam session, or a fixed set of questions drawn once, for everyone, at
// creation. Every attempt is an 'exam'-mode practice attempt tied to the assignment, taken and
// scored through the practice attempt routes (routes/practice.ts). They follow section_activities
// (draft/open/closed, opens/due dates, max attempts, evidence policy). Staff (owner, teacher, TA,
// platform admin) manage them; they work even when a Section's free practice is off.
// Phase 3b (PS-TASK-20260926-789): the staff results view, CSV export, and an opt-in,
// teacher-triggered gradebook sync with the same rules as learning activities. Only owner, teacher,
// or a platform admin links a gradebook assignment or syncs.

const idSchema = z.uuid();
const policySchema = z.enum(["first", "best", "last", "mean"]);
const reviewSchema = z.enum(["after_due", "after_submit"]);
const createSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    kind: z.enum(["exam", "set"]),
    examId: z.uuid().nullable().optional(),
    category: z.string().trim().min(1).max(100).nullable().optional(),
    count: z.number().int().min(1).max(100).default(20),
    timed: z.boolean().default(true),
    timeLimitMinutes: z.number().int().min(1).max(600).nullable().optional(),
    opensAt: z.iso.datetime({ offset: true }).nullable().optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    maxAttempts: z.number().int().min(1).max(100).nullable().default(1),
    evidencePolicy: policySchema.default("best"),
    reviewPolicy: reviewSchema.default("after_due"),
  })
  .refine((v) => !(v.opensAt && v.dueAt) || new Date(v.dueAt) > new Date(v.opensAt), { message: "dueAt must be after opensAt", path: ["dueAt"] });
const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    status: z.enum(["draft", "open", "closed"]),
    opensAt: z.iso.datetime({ offset: true }).nullable(),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
    maxAttempts: z.number().int().min(1).max(100).nullable(),
    evidencePolicy: policySchema,
    reviewPolicy: reviewSchema,
    // The gradebook assignment a sync writes to (same Section), or null to unlink. Owner/teacher only.
    gradebookAssignmentId: z.uuid().nullable(),
  })
  .partial();
const syncSchema = z.object({ overwriteUserIds: z.array(z.uuid()).max(2000).default([]) });
const startSchema = z.object({ lang: z.enum(["en", "th"]).default("en") });

interface AssignmentRow {
  id: string;
  section_id: string;
  title: string;
  kind: "exam" | "set";
  exam_session_id: string | null;
  category: string | null;
  question_ids: string[];
  time_limit_seconds: number | null;
  status: "draft" | "open" | "closed";
  opens_at: Date | null;
  due_at: Date | null;
  max_attempts: number | null;
  evidence_policy: "first" | "best" | "last" | "mean";
  review_policy: "after_due" | "after_submit";
  assignment_id: string | null;
  created_at: Date;
}

interface AttemptSummary {
  id: string;
  status: string;
  correct_count: number | null;
  question_count: number;
  started_at: Date;
  finished_at: Date | null;
}

/** Whether a learner can start (or resume) an attempt now. */
export function availableNow(a: Pick<AssignmentRow, "status" | "opens_at" | "due_at">, now = new Date()) {
  return a.status === "open" && (!a.opens_at || a.opens_at <= now) && (!a.due_at || a.due_at > now);
}

/** The score that counts under the evidence policy, as a ratio of the questions; null if none finished. */
export function evidenceRatio(attempts: AttemptSummary[], policy: AssignmentRow["evidence_policy"]) {
  const done = attempts
    .filter((a) => a.status === "finished" && a.correct_count !== null)
    .sort((x, y) => x.started_at.getTime() - y.started_at.getTime());
  if (!done.length) return null;
  const ratios = done.map((a) => a.correct_count! / a.question_count);
  if (policy === "first") return ratios[0]!;
  if (policy === "last") return ratios[ratios.length - 1]!;
  if (policy === "best") return Math.max(...ratios);
  return ratios.reduce((n, r) => n + r, 0) / ratios.length;
}

/** The finished attempt the evidence policy counts; for `mean`, the latest (it averages them all). */
export function evidenceAttempt(finished: AttemptSummary[], policy: AssignmentRow["evidence_policy"]) {
  const done = finished.filter((a) => a.correct_count !== null).sort((x, y) => x.started_at.getTime() - y.started_at.getTime());
  if (!done.length) return null;
  if (policy === "first") return done[0]!;
  if (policy === "best") return done.reduce((b, a) => (a.correct_count! / a.question_count > b.correct_count! / b.question_count ? a : b));
  return done[done.length - 1]!;
}

function view(a: AssignmentRow) {
  return {
    id: a.id,
    title: a.title,
    kind: a.kind,
    examId: a.exam_session_id,
    category: a.category,
    questionCount: a.question_ids.length,
    timeLimitSeconds: a.time_limit_seconds,
    status: a.status,
    opensAt: a.opens_at,
    dueAt: a.due_at,
    maxAttempts: a.max_attempts,
    evidencePolicy: a.evidence_policy,
    reviewPolicy: a.review_policy,
    gradebookAssignmentId: a.assignment_id,
    availableNow: availableNow(a),
  };
}

/** Points for a gradebook cell: the evidence ratio of the cell's maximum, to two decimals. */
function pointsFor(scoreRatio: number, maxPoints: number) {
  return Math.round(scoreRatio * maxPoints * 100) / 100;
}

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "INVALID_REQUEST", fields: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
}

export async function registerPracticeAssignmentRoutes(app: FastifyInstance, dependencies: { pool: DatabasePool; config: AppConfig }) {
  const { pool, config } = dependencies;
  const perUser = { config: { rateLimit: { max: 120, timeWindow: "1 minute", keyGenerator: sessionRateLimitKey(pool, config) } } };

  async function member(request: FastifyRequest, reply: FastifyReply, sectionId: string) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    if (!idSchema.safeParse(sectionId).success) {
      await reply.code(400).send({ error: "INVALID_REQUEST" });
      return null;
    }
    const exists = await pool.query("SELECT 1 FROM sections WHERE id = $1", [sectionId]);
    if (!exists.rowCount) {
      await reply.code(404).send({ error: "SECTION_NOT_FOUND" });
      return null;
    }
    const roles = await getSectionRoles(pool, user.id, sectionId);
    const staff = user.isPlatformAdmin || canManageSessions(roles);
    if (!staff && roles.length === 0) {
      await reply.code(403).send({ error: "FORBIDDEN" });
      return null;
    }
    // Gradebook authority: owner or teacher (not TA), or a platform admin.
    const grader = user.isPlatformAdmin || hasAnyRole(roles, ["owner", "teacher"]);
    return { user, sectionId, staff, grader };
  }

  async function loadAssignment(request: FastifyRequest, reply: FastifyReply) {
    const { assignmentId } = request.params as { assignmentId: string };
    if (!idSchema.safeParse(assignmentId).success) {
      await reply.code(400).send({ error: "INVALID_REQUEST" });
      return null;
    }
    const row = (await pool.query<AssignmentRow>("SELECT * FROM practice_assignments WHERE id = $1", [assignmentId])).rows[0];
    if (!row) {
      await reply.code(404).send({ error: "ASSIGNMENT_NOT_FOUND" });
      return null;
    }
    const ctx = await member(request, reply, row.section_id);
    if (!ctx) return null;
    // Students never see a draft.
    if (!ctx.staff && row.status === "draft") {
      await reply.code(404).send({ error: "ASSIGNMENT_NOT_FOUND" });
      return null;
    }
    return { ctx, assignment: row };
  }

  async function attemptsOf(assignmentId: string, userId: string) {
    return (await pool.query<AttemptSummary>(
      `SELECT id, status, correct_count, cardinality(question_ids) AS question_count, started_at, finished_at
       FROM practice_attempts WHERE practice_assignment_id = $1 AND user_id = $2 ORDER BY started_at`,
      [assignmentId, userId],
    )).rows;
  }

  // Settles this learner's expired assignment attempts, like the practice routes do on read.
  async function settle(assignmentId: string, userId: string) {
    await pool.query(
      `UPDATE practice_attempts AS a
       SET status = 'finished', finish_reason = 'time_up', finished_at = a.deadline_at,
           correct_count = (SELECT count(*)::int FROM practice_answers AS x WHERE x.attempt_id = a.id AND x.is_correct)
       WHERE a.practice_assignment_id = $1 AND a.user_id = $2 AND a.status = 'in_progress'
         AND a.deadline_at IS NOT NULL AND now() > a.deadline_at + interval '5 seconds'`,
      [assignmentId, userId],
    );
  }

  // --- Create (staff) ---
  app.post("/api/sections/:sectionId/practice/assignments", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    const ctx = await member(request, reply, sectionId);
    if (!ctx) return;
    if (!ctx.staff) return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const d = parsed.data;
    if (d.kind === "exam" && !d.examId) return reply.code(400).send({ error: "EXAM_REQUIRED" });
    let limitMinutes: number | null = null;
    if (d.examId) {
      const exam = await pool.query<{ time_limit_minutes: number | null }>("SELECT time_limit_minutes FROM exam_sessions WHERE id = $1", [d.examId]);
      if (!exam.rowCount) return reply.code(404).send({ error: "EXAM_NOT_FOUND" });
      limitMinutes = exam.rows[0]!.time_limit_minutes;
    }
    // A whole session defaults to its own time limit; a set needs an explicit one if timed.
    const minutes = d.timed ? d.timeLimitMinutes ?? (d.kind === "exam" ? limitMinutes : null) : null;
    if (d.timed && !minutes) return reply.code(400).send({ error: "TIME_LIMIT_REQUIRED" });
    const filters: string[] = [];
    const params: unknown[] = [];
    if (d.examId) {
      params.push(d.examId);
      filters.push(`exam_session_id = $${params.length}`);
    }
    const category = d.kind === "set" ? d.category ?? null : null;
    if (category) {
      params.push(category);
      filters.push(`category = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    // Drawn once, here, so every learner gets the same questions.
    const order = d.kind === "set" ? `ORDER BY random() LIMIT ${d.count}` : "ORDER BY seq";
    const picked = await pool.query<{ id: string }>(`SELECT id FROM practice_questions ${where} ${order}`, params);
    if (!picked.rowCount) return reply.code(400).send({ error: "NO_QUESTIONS" });
    // A drawn set keeps the session's own order, so it reads like a paper.
    const ids = picked.rows.map((r) => r.id);
    const ordered = d.kind === "set"
      ? (await pool.query<{ id: string }>(
          `SELECT q.id FROM practice_questions AS q JOIN exam_sessions AS s ON s.id = q.exam_session_id
           WHERE q.id = ANY($1::uuid[]) ORDER BY s.content_id, q.seq`,
          [ids],
        )).rows.map((r) => r.id)
      : ids;
    const inserted = await pool.query<AssignmentRow>(
      `INSERT INTO practice_assignments (section_id, title, kind, exam_session_id, category, question_ids, time_limit_seconds,
         opens_at, due_at, max_attempts, evidence_policy, review_policy, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [sectionId, d.title, d.kind, d.examId ?? null, category, ordered, minutes ? minutes * 60 : null, d.opensAt ?? null, d.dueAt ?? null,
        d.maxAttempts, d.evidencePolicy, d.reviewPolicy, ctx.user.id],
    );
    const row = inserted.rows[0]!;
    await pool.query(
      `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
       VALUES ($1, 'practice.assignment_created', 'practice_assignment', $2, $3::jsonb)`,
      [ctx.user.id, row.id, JSON.stringify({ sectionId, kind: row.kind, questions: ordered.length })],
    );
    return reply.code(201).send({ assignment: view(row) });
  });

  // --- List: staff see every assignment with completion counts; learners see non-draft ones with their own attempts ---
  app.get("/api/sections/:sectionId/practice/assignments", async (request, reply) => {
    const { sectionId } = request.params as { sectionId: string };
    const ctx = await member(request, reply, sectionId);
    if (!ctx) return;
    const rows = (await pool.query<AssignmentRow>(
      `SELECT * FROM practice_assignments WHERE section_id = $1 ${ctx.staff ? "" : "AND status <> 'draft'"}
       ORDER BY COALESCE(due_at, created_at) DESC, created_at DESC`,
      [sectionId],
    )).rows;
    const assignments = [];
    for (const a of rows) {
      await settle(a.id, ctx.user.id);
      const mine = await attemptsOf(a.id, ctx.user.id);
      const entry: Record<string, unknown> = {
        ...view(a),
        myAttempts: mine.map((m) => ({
          id: m.id,
          status: m.status,
          correct: m.status === "finished" ? m.correct_count : null,
          questionCount: m.question_count,
          finishedAt: m.finished_at,
        })),
        myInProgressAttemptId: mine.find((m) => m.status === "in_progress")?.id ?? null,
        myScoreRatio: evidenceRatio(mine, a.evidence_policy),
        attemptsLeft: a.max_attempts === null ? null : Math.max(0, a.max_attempts - mine.length),
      };
      if (ctx.staff) {
        // Learners only: a teacher's preview attempt is not progress.
        const counts = (await pool.query<{ started: number; submitted: number }>(
          `SELECT count(DISTINCT t.user_id)::int AS started,
                  count(DISTINCT t.user_id) FILTER (WHERE t.status = 'finished')::int AS submitted
           FROM practice_attempts AS t JOIN users AS u ON u.id = t.user_id
           WHERE t.practice_assignment_id = $1 AND NOT u.is_platform_admin
             AND NOT EXISTS (SELECT 1 FROM memberships AS m WHERE m.user_id = t.user_id AND m.section_id = $2
                             AND m.roles && ARRAY['owner', 'teacher', 'ta'])`,
          [a.id, a.section_id],
        )).rows[0]!;
        entry.progress = counts;
      }
      assignments.push(entry);
    }
    return reply.send({ canManage: ctx.staff, assignments });
  });

  // --- Update (staff) ---
  app.patch("/api/practice-assignments/:assignmentId", async (request, reply) => {
    const loaded = await loadAssignment(request, reply);
    if (!loaded) return;
    if (!loaded.ctx.staff) return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const d = parsed.data;
    const a = loaded.assignment;
    if (d.gradebookAssignmentId !== undefined) {
      if (!loaded.ctx.grader) return reply.code(403).send({ error: "FORBIDDEN" });
      if (d.gradebookAssignmentId) {
        const inSection = await pool.query(
          `SELECT 1 FROM assignments AS g JOIN categories AS c ON c.id = g.category_id WHERE g.id = $1 AND c.section_id = $2`,
          [d.gradebookAssignmentId, a.section_id],
        );
        if (!inSection.rowCount) return reply.code(400).send({ error: "GRADEBOOK_ASSIGNMENT_NOT_IN_SECTION" });
      }
    }
    const opensAt = d.opensAt === undefined ? a.opens_at : d.opensAt ? new Date(d.opensAt) : null;
    const dueAt = d.dueAt === undefined ? a.due_at : d.dueAt ? new Date(d.dueAt) : null;
    if (opensAt && dueAt && dueAt <= opensAt) return reply.code(400).send({ error: "DUE_BEFORE_OPEN" });
    const updated = await withTransaction(pool, async (client) => {
      const row = (await client.query<AssignmentRow>(
        `UPDATE practice_assignments SET title = $2, status = $3, opens_at = $4, due_at = $5, max_attempts = $6,
           evidence_policy = $7, review_policy = $8, assignment_id = $9, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [a.id, d.title ?? a.title, d.status ?? a.status, opensAt, dueAt,
          d.maxAttempts === undefined ? a.max_attempts : d.maxAttempts, d.evidencePolicy ?? a.evidence_policy, d.reviewPolicy ?? a.review_policy,
          d.gradebookAssignmentId === undefined ? a.assignment_id : d.gradebookAssignmentId],
      )).rows[0]!;
      // Untimed attempts end at the due date, so follow a changed due date.
      if (d.dueAt !== undefined) {
        await client.query(
          "UPDATE practice_attempts SET deadline_at = $2 WHERE practice_assignment_id = $1 AND status = 'in_progress' AND time_limit_seconds IS NULL",
          [a.id, dueAt],
        );
      }
      // Closing ends every running attempt now (settled, with the usual grace, on next read).
      if (row.status === "closed" && a.status !== "closed") {
        await client.query(
          `UPDATE practice_attempts SET deadline_at = LEAST(COALESCE(deadline_at, now()), now())
           WHERE practice_assignment_id = $1 AND status = 'in_progress'`,
          [a.id],
        );
      }
      await client.query(
        `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
         VALUES ($1, 'practice.assignment_updated', 'practice_assignment', $2, $3::jsonb)`,
        [loaded.ctx.user.id, a.id, JSON.stringify(d)],
      );
      return row;
    });
    return reply.send({ assignment: view(updated) });
  });

  // --- Delete (staff; only before anyone has attempted it) ---
  app.delete("/api/practice-assignments/:assignmentId", async (request, reply) => {
    const loaded = await loadAssignment(request, reply);
    if (!loaded) return;
    if (!loaded.ctx.staff) return reply.code(403).send({ error: "FORBIDDEN" });
    const used = await pool.query("SELECT 1 FROM practice_attempts WHERE practice_assignment_id = $1 LIMIT 1", [loaded.assignment.id]);
    if (used.rowCount) return reply.code(409).send({ error: "HAS_ATTEMPTS" });
    await pool.query("DELETE FROM practice_assignments WHERE id = $1", [loaded.assignment.id]);
    return reply.code(204).send();
  });

  // --- Start (or resume) an attempt ---
  app.post("/api/practice-assignments/:assignmentId/attempts", perUser, async (request, reply) => {
    const loaded = await loadAssignment(request, reply);
    if (!loaded) return;
    const parsed = startSchema.safeParse(request.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const { ctx } = loaded;
    await settle(loaded.assignment.id, ctx.user.id);
    const outcome = await withTransaction(pool, async (client) => {
      // Row lock: two concurrent starts cannot both create an attempt.
      const a = (await client.query<AssignmentRow>("SELECT * FROM practice_assignments WHERE id = $1 FOR UPDATE", [loaded.assignment.id])).rows[0]!;
      const running = await client.query<{ id: string }>(
        "SELECT id FROM practice_attempts WHERE practice_assignment_id = $1 AND user_id = $2 AND status = 'in_progress'",
        [a.id, ctx.user.id],
      );
      if (running.rowCount) return { status: 200, body: { attemptId: running.rows[0]!.id, resumed: true } };
      if (!availableNow(a)) return { status: 409, body: { error: "NOT_AVAILABLE" } };
      const used = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM practice_attempts WHERE practice_assignment_id = $1 AND user_id = $2",
        [a.id, ctx.user.id],
      );
      if (a.max_attempts !== null && used.rows[0]!.n >= a.max_attempts) return { status: 409, body: { error: "NO_ATTEMPTS_LEFT" } };
      // A timed attempt runs to its own deadline; an untimed one ends at the due date (if any).
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO practice_attempts (user_id, section_id, mode, exam_session_id, category, lang, question_ids,
           time_limit_seconds, deadline_at, practice_assignment_id)
         VALUES ($1, $2, 'exam', $3, NULL, $4, $5::uuid[], $6::integer,
           CASE WHEN $6::integer IS NULL THEN $7::timestamptz ELSE now() + make_interval(secs => $6::integer) END, $8)
         RETURNING id`,
        [ctx.user.id, a.section_id, a.exam_session_id, parsed.data.lang, a.question_ids, a.time_limit_seconds, a.due_at, a.id],
      );
      return { status: 201, body: { attemptId: inserted.rows[0]!.id, resumed: false } };
    });
    return reply.code(outcome.status).send(outcome.body);
  });

  // ---------------------------------------------------------------------------------------------
  // Phase 3b: results, CSV export, and gradebook sync. Learners are the Section's `student`
  // members, so a teacher's preview attempt never counts.
  // ---------------------------------------------------------------------------------------------

  /** Every learner with their attempts, status, and evidence ratio (expired attempts settled first). */
  async function learnerResults(a: AssignmentRow, db: DatabasePool | DatabaseClient = pool) {
    await db.query(
      `UPDATE practice_attempts AS t
       SET status = 'finished', finish_reason = 'time_up', finished_at = t.deadline_at,
           correct_count = (SELECT count(*)::int FROM practice_answers AS x WHERE x.attempt_id = t.id AND x.is_correct)
       WHERE t.practice_assignment_id = $1 AND t.status = 'in_progress'
         AND t.deadline_at IS NOT NULL AND now() > t.deadline_at + interval '5 seconds'`,
      [a.id],
    );
    const learners = await db.query<{ user_id: string; display_name: string; email: string; student_id: string | null }>(
      `SELECT u.id AS user_id, u.display_name, u.email::text, m.student_id
       FROM memberships AS m JOIN users AS u ON u.id = m.user_id
       WHERE m.section_id = $1 AND 'student' = ANY(m.roles)
       ORDER BY m.student_id NULLS LAST, u.display_name, u.email`,
      [a.section_id],
    );
    const attempts = await db.query<AttemptSummary & { user_id: string }>(
      `SELECT id, user_id, status, correct_count, cardinality(question_ids) AS question_count, started_at, finished_at
       FROM practice_attempts WHERE practice_assignment_id = $1 ORDER BY started_at`,
      [a.id],
    );
    const byUser = new Map<string, AttemptSummary[]>();
    for (const row of attempts.rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
    return learners.rows.map((l) => {
      const mine = byUser.get(l.user_id) ?? [];
      const finished = mine.filter((m) => m.status === "finished");
      const status = finished.length ? "submitted" : mine.length ? "in_progress" : "not_started";
      return {
        userId: l.user_id,
        displayName: l.display_name,
        email: l.email,
        studentId: l.student_id,
        status,
        attempts: mine.length,
        evidenceRatio: evidenceRatio(mine, a.evidence_policy),
        // The attempt the policy counts (the latest one for `mean`, which averages them all).
        evidenceAttemptId: evidenceAttempt(finished, a.evidence_policy)?.id ?? null,
        lastFinishedAttemptId: finished[finished.length - 1]?.id ?? null,
        lastFinishedAt: finished[finished.length - 1]?.finished_at ?? null,
      };
    });
  }

  async function staffAssignment(request: FastifyRequest, reply: FastifyReply, needGrader: boolean) {
    const loaded = await loadAssignment(request, reply);
    if (!loaded) return null;
    if (!loaded.ctx.staff || (needGrader && !loaded.ctx.grader)) {
      await reply.code(403).send({ error: "FORBIDDEN" });
      return null;
    }
    return loaded;
  }

  app.get("/api/practice-assignments/:assignmentId/results", async (request, reply) => {
    const loaded = await staffAssignment(request, reply, false);
    if (!loaded) return;
    const a = loaded.assignment;
    const learners = await learnerResults(a);
    // Per field, from each learner's latest finished attempt (the one the results link to).
    const latest = learners.map((l) => l.lastFinishedAttemptId).filter((id): id is string => Boolean(id));
    const fieldRows = latest.length
      ? (await pool.query<{ attempt_id: string; field: string; questions: number; correct: number }>(
          `SELECT t.id AS attempt_id, q.field, count(*)::int AS questions, count(x.question_id) FILTER (WHERE x.is_correct)::int AS correct
           FROM practice_attempts AS t CROSS JOIN LATERAL unnest(t.question_ids) AS qid
           JOIN practice_questions AS q ON q.id = qid
           LEFT JOIN practice_answers AS x ON x.attempt_id = t.id AND x.question_id = qid
           WHERE t.id = ANY($1::uuid[]) GROUP BY t.id, q.field`,
          [latest],
        )).rows
      : [];
    const fieldsOf = new Map<string, { field: string; questions: number; correct: number }[]>();
    for (const r of fieldRows) fieldsOf.set(r.attempt_id, [...(fieldsOf.get(r.attempt_id) ?? []), { field: r.field, questions: r.questions, correct: r.correct }]);
    // Item analysis over every finished learner attempt.
    const items = (await pool.query<{ question_id: string; seq: number; content_id: string; exam_content_id: string; category: string; field: string; answered: number; correct: number; attempts: number }>(
      `WITH learner_attempts AS (
         SELECT t.id, t.question_ids FROM practice_attempts AS t
         JOIN memberships AS m ON m.user_id = t.user_id AND m.section_id = $2 AND 'student' = ANY(m.roles)
         WHERE t.practice_assignment_id = $1 AND t.status = 'finished'
       )
       SELECT q.id AS question_id, q.seq, q.content_id, s.content_id AS exam_content_id, q.category, q.field,
              count(x.question_id)::int AS answered, count(x.question_id) FILTER (WHERE x.is_correct)::int AS correct,
              count(*)::int AS attempts
       FROM learner_attempts AS la CROSS JOIN LATERAL unnest(la.question_ids) AS qid
       JOIN practice_questions AS q ON q.id = qid JOIN exam_sessions AS s ON s.id = q.exam_session_id
       LEFT JOIN practice_answers AS x ON x.attempt_id = la.id AND x.question_id = qid
       GROUP BY q.id, q.seq, q.content_id, s.content_id, q.category, q.field
       ORDER BY count(x.question_id) FILTER (WHERE x.is_correct)::float / count(*), s.content_id, q.seq`,
      [a.id, a.section_id],
    )).rows;
    const ratios = learners.map((l) => l.evidenceRatio).filter((r): r is number => r !== null).sort((x, y) => x - y);
    const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i / 10, to: (i + 1) / 10, count: 0 }));
    for (const r of ratios) buckets[Math.min(9, Math.floor(r * 10))]!.count += 1;
    const median = ratios.length ? (ratios.length % 2 ? ratios[(ratios.length - 1) / 2]! : (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2) : null;
    return reply.send({
      assignment: view(a),
      canSync: loaded.ctx.grader,
      summary: {
        learners: learners.length,
        notStarted: learners.filter((l) => l.status === "not_started").length,
        inProgress: learners.filter((l) => l.status === "in_progress").length,
        submitted: learners.filter((l) => l.status === "submitted").length,
        mean: ratios.length ? ratios.reduce((n, r) => n + r, 0) / ratios.length : null,
        median,
        distribution: buckets,
      },
      learners: learners.map((l) => ({ ...l, fields: l.lastFinishedAttemptId ? fieldsOf.get(l.lastFinishedAttemptId) ?? [] : [] })),
      items: items.map((i) => ({
        questionId: i.question_id,
        seq: i.seq,
        contentId: i.content_id,
        examContentId: i.exam_content_id,
        category: i.category,
        field: i.field,
        attempts: i.attempts,
        answered: i.answered,
        correct: i.correct,
      })),
    });
  });

  app.get("/api/practice-assignments/:assignmentId/results/export", async (request, reply) => {
    const loaded = await staffAssignment(request, reply, false);
    if (!loaded) return;
    const a = loaded.assignment;
    const learners = await learnerResults(a);
    const maxPoints = a.assignment_id
      ? Number((await pool.query<{ max_points: string }>("SELECT max_points FROM assignments WHERE id = $1", [a.assignment_id])).rows[0]?.max_points ?? NaN)
      : NaN;
    const header = ["Student ID", "Student Name", "Student Email", "Status", "Attempts", `Score % (${a.evidence_policy})`, "Last Finished At"];
    if (Number.isFinite(maxPoints)) header.push(`Points (of ${maxPoints})`);
    const rows = learners.map((l) => {
      const row: unknown[] = [
        l.studentId ?? "",
        l.displayName,
        l.email,
        l.status,
        l.attempts,
        l.evidenceRatio === null ? "" : (l.evidenceRatio * 100).toFixed(2),
        l.lastFinishedAt ? new Date(l.lastFinishedAt).toISOString() : "",
      ];
      if (Number.isFinite(maxPoints)) row.push(l.evidenceRatio === null ? "" : pointsFor(l.evidenceRatio, maxPoints));
      return row;
    });
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="practice-assignment-${a.id}.csv"`)
      .send(toCsv([header, ...rows]));
  });

  // Gradebook sync: the same statuses and rules as learning activities (routes/activities.ts):
  //   no_attempt  no finished attempt: the cell is left alone (never zeroed, never deleted)
  //   new         no score yet: written
  //   unchanged   the cell already holds the policy's points
  //   changed     the cell still holds exactly what this assignment last synced: rewritten
  //   manual      any other value (typed by hand, edited after a sync, or written by something
  //               else): kept unless the teacher lists the learner in overwriteUserIds
  type SyncStatus = "no_attempt" | "new" | "unchanged" | "changed" | "manual";

  async function syncPlan(a: AssignmentRow, db: DatabasePool | DatabaseClient = pool) {
    if (!a.assignment_id) return null;
    const target = (await db.query<{ id: string; name: string; max_points: string }>("SELECT id, name, max_points FROM assignments WHERE id = $1", [a.assignment_id])).rows[0];
    if (!target) return null;
    const maxPoints = Number(target.max_points);
    const learners = await learnerResults(a, db);
    const scores = await db.query<{ user_id: string; points_earned: string; synced_from_practice_assignment_id: string | null; synced_points: string | null }>(
      "SELECT user_id, points_earned, synced_from_practice_assignment_id, synced_points FROM scores WHERE assignment_id = $1",
      [target.id],
    );
    const byUser = new Map(scores.rows.map((row) => [row.user_id, row]));
    const same = (x: number, y: number) => Math.abs(x - y) < 1e-9;
    const rows = learners.map((l) => {
      const current = byUser.get(l.userId);
      const currentPoints = current ? Number(current.points_earned) : null;
      const newPoints = l.evidenceRatio === null ? null : pointsFor(l.evidenceRatio, maxPoints);
      let status: SyncStatus;
      if (newPoints === null) status = "no_attempt";
      else if (!current || currentPoints === null) status = "new";
      else if (same(currentPoints, newPoints)) status = "unchanged";
      else if (current.synced_from_practice_assignment_id === a.id && current.synced_points !== null && same(currentPoints, Number(current.synced_points))) status = "changed";
      else status = "manual";
      return { userId: l.userId, displayName: l.displayName, email: l.email, studentId: l.studentId, currentPoints, newPoints, status };
    });
    return { assignment: { id: target.id, name: target.name, maxPoints }, policy: a.evidence_policy, rows };
  }

  app.get("/api/practice-assignments/:assignmentId/gradebook-sync", async (request, reply) => {
    const loaded = await staffAssignment(request, reply, true);
    if (!loaded) return;
    const plan = await syncPlan(loaded.assignment);
    if (!plan) return reply.code(409).send({ error: "NO_LINKED_ASSIGNMENT" });
    return reply.send(plan);
  });

  app.post("/api/practice-assignments/:assignmentId/gradebook-sync", async (request, reply) => {
    const loaded = await staffAssignment(request, reply, true);
    if (!loaded) return;
    const parsed = syncSchema.safeParse(request.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const overwrite = new Set(parsed.data.overwriteUserIds);
    const a = loaded.assignment;
    // The apply recomputes at confirm time, so a learner who finished since the preview is fresh.
    const outcome = await withTransaction(pool, async (client) => {
      const plan = await syncPlan(a, client);
      if (!plan) return null;
      const written: { userId: string; status: SyncStatus; points: number }[] = [];
      for (const row of plan.rows) {
        const write = row.status === "new" || row.status === "changed" || (row.status === "manual" && overwrite.has(row.userId));
        if (!write || row.newPoints === null) continue;
        await client.query(
          `INSERT INTO scores (assignment_id, user_id, points_earned, synced_from_practice_assignment_id, synced_from_activity_id, synced_points, synced_at)
           VALUES ($1, $2, $3, $4, NULL, $3, now())
           ON CONFLICT (assignment_id, user_id) DO UPDATE
           SET points_earned = EXCLUDED.points_earned, synced_from_practice_assignment_id = EXCLUDED.synced_from_practice_assignment_id,
               synced_from_activity_id = NULL, synced_points = EXCLUDED.synced_points, synced_at = now(), updated_at = now()`,
          [plan.assignment.id, row.userId, row.newPoints, a.id],
        );
        written.push({ userId: row.userId, status: row.status, points: row.newPoints });
      }
      const counts = Object.fromEntries((["new", "changed", "unchanged", "manual", "no_attempt"] as const).map((k) => [k, plan.rows.filter((r) => r.status === k).length]));
      await client.query(
        `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
         VALUES ($1, 'practice.assignment_gradebook_synced', 'practice_assignment', $2, $3::jsonb)`,
        [loaded.ctx.user.id, a.id, JSON.stringify({ assignmentId: plan.assignment.id, policy: plan.policy, counts, written: written.length,
          overwrittenManual: written.filter((w) => w.status === "manual").map((w) => w.userId) })],
      );
      return { assignment: plan.assignment, policy: plan.policy, counts, written };
    });
    if (!outcome) return reply.code(409).send({ error: "NO_LINKED_ASSIGNMENT" });
    return reply.send(outcome);
  });
}
