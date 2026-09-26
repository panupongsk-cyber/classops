import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { canManageSessions, getSectionRoles, hasAnyRole, type AuthenticatedUser } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";
import { sessionRateLimitKey } from "../rate-limit-key.js";

// Exam practice, Phase 1 (PS-TASK-20260925-755): ITPEC IT Passport, per-Section opt-in. Content
// was imported from ps-practice-package/v1 files (scripts/import-practice.ts). An answer key is
// never sent before the learner answers, except in browse mode, whose purpose is to show it.
// Phase 2a (PS-TASK-20260925-767) adds the mock exam: a whole session, no key or correctness
// until it is finished, changeable answers and flags, and a server-side deadline.
// Phase 2b (PS-TASK-20260925-770) adds bookmarks, a mistakes quiz, personal statistics, and the
// most-missed ranking. None of them count answers from a mock exam still in progress.
// Phase 3a (PS-TASK-20260926-785) adds teacher-set assignments (routes/practice-assignments.ts).
// While an assignment is open, students in its Section get no key for its questions anywhere
// here (browse, most-missed, practice and quiz draws, reviews), and cannot take a self mock exam
// of a session that contains them. Staff are exempt. The papers are public, so this deters rather
// than secures.

const idSchema = z.uuid();
const startSchema = z.object({
  mode: z.enum(["practice", "quiz", "exam"]),
  timed: z.boolean().default(true),
  examId: z.uuid().nullable().optional(),
  category: z.string().trim().min(1).max(100).nullable().optional(),
  lang: z.enum(["en", "th"]).default("en"),
  count: z.number().int().min(1).max(100).default(10),
  // A quick quiz can draw from every question, the learner's bookmarks, or their current mistakes.
  source: z.enum(["all", "bookmarks", "mistakes"]).default("all"),
});
const bookmarkSchema = z.object({ questionId: z.uuid(), bookmarked: z.boolean() });
const mostMissedQuery = z.object({
  examId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// The most-missed ranking lists a question only once it has this many counted answers, from at
// least MIN_LEARNERS different learners, so it never singles out one person's mistakes.
const MOST_MISSED_MIN_ANSWERS = 10;
const MOST_MISSED_MIN_LEARNERS = 3;

/**
 * Answers that count toward mistakes, statistics, and the ranking: every answer in the Section,
 * except those in a mock exam still in progress (their correctness is hidden until it finishes).
 * `$section` is the parameter placeholder for the Section id.
 */
const countedAnswers = (section: string) => `
  SELECT x.question_id, x.is_correct, x.answered_at, a.user_id
  FROM practice_answers AS x JOIN practice_attempts AS a ON a.id = x.attempt_id
  WHERE a.section_id = ${section} AND (a.mode <> 'exam' OR a.status = 'finished')`;

/** Questions whose latest counted answer by this learner is wrong. */
const mistakeIds = (section: string, user: string) => `
  SELECT question_id FROM (
    SELECT DISTINCT ON (c.question_id) c.question_id, c.is_correct
    FROM (${countedAnswers(section)}) AS c
    WHERE c.user_id = ${user}
    ORDER BY c.question_id, c.answered_at DESC
  ) AS latest WHERE NOT latest.is_correct`;

const answerSchema = z.object({ questionId: z.uuid(), selected: z.string().regex(/^[a-z]$/) });
// A mock-exam answer may also be cleared.
const examAnswerSchema = z.object({ questionId: z.uuid(), selected: z.string().regex(/^[a-z]$/).nullable() });
const flagSchema = z.object({ questionId: z.uuid(), flagged: z.boolean() });

// Answers that arrive this long after the deadline still count, so a click in the last second is
// not lost to network latency. The client stops accepting input at the deadline itself.
const DEADLINE_GRACE_SECONDS = 5;

// Pass rules by exam family, from the official "Outline of ITPEC Common Examination from April
// 2024": IP has 100 points (one per question); pass is 60% of the total and 30% in each field.
// Field tags are analyst-inferred, so the result is an unofficial estimate.
const PASS_RULES: Record<string, { total: number; perField: number }> = {
  "itpec-ip": { total: 0.6, perField: 0.3 },
};

interface ScoredQuestion { id: string; field: string; category: string }

/** Per-field and per-category tallies of an attempt, plus a pass estimate where the family has a rule. */
export function scoreAttempt(
  questions: ScoredQuestion[],
  correctIds: Set<string>,
  answeredIds: Set<string>,
  family: string | null,
  fieldOrder: string[] = [],
) {
  const tally = <K extends string>(key: (q: ScoredQuestion) => K) => {
    const map = new Map<K, { questions: number; answered: number; correct: number }>();
    for (const q of questions) {
      const entry = map.get(key(q)) ?? { questions: 0, answered: 0, correct: 0 };
      entry.questions += 1;
      if (answeredIds.has(q.id)) entry.answered += 1;
      if (correctIds.has(q.id)) entry.correct += 1;
      map.set(key(q), entry);
    }
    return map;
  };
  const rule = family ? PASS_RULES[family] : undefined;
  // Fields in the session's own order (its categories list), then any others by first appearance.
  const rank = (field: string) => (fieldOrder.includes(field) ? fieldOrder.indexOf(field) : fieldOrder.length);
  const fields = [...tally((q) => q.field)].sort(([a], [b]) => rank(a) - rank(b)).map(([field, t]) => ({
    field,
    ...t,
    ratio: t.questions ? t.correct / t.questions : 0,
    pass: rule ? t.questions > 0 && t.correct / t.questions >= rule.perField : null,
  }));
  const correct = questions.filter((q) => correctIds.has(q.id)).length;
  const ratio = questions.length ? correct / questions.length : 0;
  return {
    correct,
    questions: questions.length,
    ratio,
    fields,
    pass: rule ? ratio >= rule.total && fields.every((f) => f.pass) : null,
    rule: rule ?? null,
  };
}

/** The same pass estimate from per-field totals (for the statistics trend). */
export function passFromFieldTotals(fields: { correct: number; questions: number }[], family: string | null) {
  const rule = family ? PASS_RULES[family] : undefined;
  if (!rule) return null;
  const correct = fields.reduce((n, f) => n + f.correct, 0);
  const questions = fields.reduce((n, f) => n + f.questions, 0);
  return questions > 0 && correct / questions >= rule.total && fields.every((f) => f.questions > 0 && f.correct / f.questions >= rule.perField);
}
const enableSchema = z.object({ enabled: z.boolean() });
const browseQuery = z.object({
  category: z.string().trim().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

interface QuestionRow {
  id: string;
  content_id: string;
  seq: number;
  stem: { en: string; th?: string };
  options: { label: string; text: { en: string; th?: string } }[];
  answer: string;
  category: string;
  field: string;
  figure_en: string | null;
  figure_th: string | null;
  exam_content_id: string;
}

const QUESTION_COLUMNS = `q.id, q.content_id, q.seq, q.stem, q.options, q.answer, q.category, q.field, q.figure_en, q.figure_th,
  s.content_id AS exam_content_id`;

/** Browser view of one question. `withAnswer` only in browse mode or after the learner answered. */
/**
 * When an assignment's answers stop needing protection: a timed attempt started just before the
 * due date may run its full time limit past it, plus the deadline grace.
 */
export function assignmentReviewOpensAt(a: { due_at: Date | null; time_limit_seconds: number | null }) {
  return a.due_at ? new Date(a.due_at.getTime() + ((a.time_limit_seconds ?? 0) + DEADLINE_GRACE_SECONDS) * 1000) : null;
}

/**
 * Question ids of the Section's open assignments (open, and not past their effective close, as
 * above): their keys are withheld from students until then.
 */
export async function lockedQuestionIds(pool: DatabasePool, sectionId: string) {
  const rows = await pool.query<{ id: string }>(
    `SELECT DISTINCT unnest(question_ids) AS id FROM practice_assignments
     WHERE section_id = $1 AND status = 'open'
       AND (due_at IS NULL OR due_at + make_interval(secs => COALESCE(time_limit_seconds, 0) + $2) > now())`,
    [sectionId, DEADLINE_GRACE_SECONDS],
  );
  return new Set(rows.rows.map((r) => r.id));
}

function questionView(q: QuestionRow, withAnswer: boolean) {
  const figure = (id: string | null) => (id ? `/api/practice/figures/${encodeURIComponent(id)}` : null);
  return {
    id: q.id,
    contentId: q.content_id,
    examContentId: q.exam_content_id,
    seq: q.seq,
    stem: q.stem,
    options: q.options,
    category: q.category,
    field: q.field,
    figure: { en: figure(q.figure_en), th: figure(q.figure_th) },
    ...(withAnswer ? { answer: q.answer } : {}),
  };
}

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "INVALID_REQUEST", fields: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
}

export async function registerPracticeRoutes(app: FastifyInstance, dependencies: { pool: DatabasePool; config: AppConfig }) {
  const { pool, config } = dependencies;
  const perUser = { config: { rateLimit: { max: 120, timeWindow: "1 minute", keyGenerator: sessionRateLimitKey(pool, config) } } };

  /**
   * A Section member; students only while practice is enabled (unless `requireEnabled` is false,
   * for assignment attempts), staff (and admins) always. `locked` is the set of question ids whose
   * key this caller must not see (always empty for staff).
   */
  async function authorizeSection(request: FastifyRequest, reply: FastifyReply, options: { requireEnabled?: boolean } = {}) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    const { sectionId } = request.params as { sectionId: string };
    if (!idSchema.safeParse(sectionId).success) {
      await reply.code(400).send({ error: "INVALID_REQUEST" });
      return null;
    }
    const section = await pool.query<{ practice_enabled: boolean }>("SELECT practice_enabled FROM sections WHERE id = $1", [sectionId]);
    if (!section.rowCount) {
      await reply.code(404).send({ error: "SECTION_NOT_FOUND" });
      return null;
    }
    const roles = await getSectionRoles(pool, user.id, sectionId);
    const staff = user.isPlatformAdmin || canManageSessions(roles);
    if (!staff && roles.length === 0) {
      await reply.code(403).send({ error: "FORBIDDEN" });
      return null;
    }
    const enabled = section.rows[0]!.practice_enabled;
    if (!staff && !enabled && options.requireEnabled !== false) {
      await reply.code(403).send({ error: "PRACTICE_NOT_ENABLED" });
      return null;
    }
    const locked = staff ? new Set<string>() : await lockedQuestionIds(pool, sectionId);
    return { user, sectionId, staff, enabled, roles, locked };
  }

  async function loadQuestions(ids: string[]) {
    const result = await pool.query<QuestionRow>(
      `SELECT ${QUESTION_COLUMNS} FROM practice_questions AS q JOIN exam_sessions AS s ON s.id = q.exam_session_id WHERE q.id = ANY($1::uuid[])`,
      [ids],
    );
    const byId = new Map(result.rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((q): q is QuestionRow => Boolean(q));
  }

  // --- Enable / disable (owner, teacher, or platform admin) ---
  app.patch("/api/sections/:sectionId/practice", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    if (!idSchema.safeParse(sectionId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    if (!user.isPlatformAdmin && !hasAnyRole(await getSectionRoles(pool, user.id, sectionId), ["owner", "teacher"])) {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const parsed = enableSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const updated = await pool.query("UPDATE sections SET practice_enabled = $2, updated_at = now() WHERE id = $1", [sectionId, parsed.data.enabled]);
    if (!updated.rowCount) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    await pool.query(
      `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
       VALUES ($1, 'practice.section_toggled', 'section', $2, $3::jsonb)`,
      [user.id, sectionId, JSON.stringify({ enabled: parsed.data.enabled })],
    );
    return reply.send({ enabled: parsed.data.enabled });
  });

  // --- Catalogue ---
  app.get("/api/sections/:sectionId/practice/exams", async (request, reply) => {
    const ctx = await authorizeSection(request, reply);
    if (!ctx) return;
    const exams = await pool.query(
      `SELECT id, content_id, family, title, subtitle, provider, session_label, item_count, time_limit_minutes, languages,
              categories, category_provenance, answer_key_provenance, attribution, translation_note
       FROM exam_sessions
       -- Newest first: year, then the October (A) administration before April (S).
       ORDER BY substring(content_id FROM 1 FOR 4) DESC, (substring(content_id FROM 5 FOR 1) = 'A') DESC, content_id`,
    );
    return reply.send({ enabled: ctx.enabled, canManage: ctx.staff, exams: exams.rows });
  });

  // --- Browse: a session's questions with answers, paged ---
  app.get("/api/sections/:sectionId/practice/exams/:examId/questions", async (request, reply) => {
    const ctx = await authorizeSection(request, reply);
    if (!ctx) return;
    const { examId } = request.params as { examId: string };
    if (!idSchema.safeParse(examId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const query = browseQuery.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error);
    const { category, offset, limit } = query.data;
    const where = `q.exam_session_id = $1 ${category ? "AND q.category = $2" : ""}`;
    const params: unknown[] = category ? [examId, category] : [examId];
    const total = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM practice_questions AS q WHERE ${where}`, params);
    const rows = await pool.query<QuestionRow>(
      `SELECT ${QUESTION_COLUMNS} FROM practice_questions AS q JOIN exam_sessions AS s ON s.id = q.exam_session_id
       WHERE ${where} ORDER BY q.seq OFFSET ${offset} LIMIT ${limit}`,
      params,
    );
    return reply.send({
      total: total.rows[0]!.n,
      offset,
      limit,
      questions: rows.rows.map((q) => ({ ...questionView(q, !ctx.locked.has(q.id)), ...(ctx.locked.has(q.id) ? { locked: true } : {}) })),
    });
  });

  // --- Start a practice run or a quick quiz ---
  app.post("/api/sections/:sectionId/practice/attempts", perUser, async (request, reply) => {
    const ctx = await authorizeSection(request, reply);
    if (!ctx) return;
    const parsed = startSchema.safeParse(request.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const { mode, examId, lang, count, timed } = parsed.data;
    const source = mode === "quiz" ? parsed.data.source : "all";
    // A mock exam is always a whole session, in order.
    const category = mode === "exam" ? null : parsed.data.category;
    if ((mode === "practice" || mode === "exam") && !examId) return reply.code(400).send({ error: "EXAM_REQUIRED" });
    const filters: string[] = [];
    const params: unknown[] = [];
    if (examId) {
      params.push(examId);
      filters.push(`exam_session_id = $${params.length}`);
    }
    if (category) {
      params.push(category);
      filters.push(`category = $${params.length}`);
    }
    if (source !== "all") {
      await settleExpiredFor(ctx.sectionId, ctx.user.id);
      params.push(ctx.sectionId, ctx.user.id);
      const [sp, up] = [`$${params.length - 1}`, `$${params.length}`];
      filters.push(
        source === "bookmarks"
          ? `id IN (SELECT question_id FROM practice_bookmarks WHERE section_id = ${sp} AND user_id = ${up})`
          : `id IN (${mistakeIds(sp, up)})`,
      );
    }
    if (ctx.locked.size) {
      if (mode === "exam") {
        const clash = await pool.query("SELECT 1 FROM practice_questions WHERE exam_session_id = $1 AND id = ANY($2::uuid[]) LIMIT 1", [examId, [...ctx.locked]]);
        if (clash.rowCount) return reply.code(409).send({ error: "LOCKED_BY_ASSIGNMENT" });
      } else {
        params.push([...ctx.locked]);
        filters.push(`NOT (id = ANY($${params.length}::uuid[]))`);
      }
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    // Practice and the mock exam walk the session in order; a quick quiz draws `count` at random.
    const order = mode === "quiz" ? `ORDER BY random() LIMIT ${count}` : "ORDER BY seq";
    const picked = await pool.query<{ id: string }>(`SELECT id FROM practice_questions ${where} ${order}`, params);
    if (!picked.rowCount) {
      const error = source === "bookmarks" ? "NO_BOOKMARKS" : source === "mistakes" ? "NO_MISTAKES" : "NO_QUESTIONS";
      return reply.code(400).send({ error });
    }
    let limitSeconds: number | null = null;
    if (mode === "exam" && timed) {
      const exam = await pool.query<{ time_limit_minutes: number | null }>("SELECT time_limit_minutes FROM exam_sessions WHERE id = $1", [examId]);
      const minutes = exam.rows[0]?.time_limit_minutes ?? null;
      if (!minutes) return reply.code(400).send({ error: "NO_TIME_LIMIT" });
      limitSeconds = minutes * 60;
    }
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO practice_attempts (user_id, section_id, mode, exam_session_id, category, lang, question_ids, time_limit_seconds, deadline_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8::integer, CASE WHEN $8::integer IS NULL THEN NULL ELSE now() + make_interval(secs => $8::integer) END)
       RETURNING id`,
      [ctx.user.id, ctx.sectionId, mode, examId ?? null, category ?? null, lang, picked.rows.map((r) => r.id), limitSeconds],
    );
    return reply.code(201).send({ attemptId: inserted.rows[0]!.id, questionCount: picked.rowCount, timeLimitSeconds: limitSeconds });
  });

  async function loadAttempt(request: FastifyRequest, reply: FastifyReply, ownerOnly: boolean) {
    // Assignment attempts work even when free practice is off; checked below once loaded.
    const ctx = await authorizeSection(request, reply, { requireEnabled: false });
    if (!ctx) return null;
    const { attemptId } = request.params as { attemptId: string };
    if (!idSchema.safeParse(attemptId).success) {
      await reply.code(400).send({ error: "INVALID_REQUEST" });
      return null;
    }
    const result = await pool.query<{
      id: string;
      user_id: string;
      mode: string;
      exam_session_id: string | null;
      category: string | null;
      lang: string;
      question_ids: string[];
      status: string;
      correct_count: number | null;
      started_at: Date;
      finished_at: Date | null;
      time_limit_seconds: number | null;
      deadline_at: Date | null;
      flagged_question_ids: string[];
      finish_reason: string | null;
      practice_assignment_id: string | null;
    }>("SELECT * FROM practice_attempts WHERE id = $1 AND section_id = $2", [attemptId, ctx.sectionId]);
    let attempt = result.rows[0];
    if (!attempt) {
      await reply.code(404).send({ error: "ATTEMPT_NOT_FOUND" });
      return null;
    }
    if (!attempt.practice_assignment_id && !ctx.staff && !ctx.enabled) {
      await reply.code(403).send({ error: "PRACTICE_NOT_ENABLED" });
      return null;
    }
    const isOwner = attempt.user_id === ctx.user.id;
    if (!isOwner && (ownerOnly || !ctx.staff)) {
      await reply.code(403).send({ error: "FORBIDDEN" });
      return null;
    }
    // A timed exam past its deadline (plus grace) is finished here, whoever reads it first.
    if (await settleExpired(attempt.id)) {
      attempt = (await pool.query<typeof attempt>("SELECT * FROM practice_attempts WHERE id = $1", [attempt.id])).rows[0]!;
    }
    return { ctx, attempt, isOwner };
  }

  /** Settles every expired exam of this learner in this Section, before reading their history. */
  async function settleExpiredFor(sectionId: string, userId: string) {
    const expired = await pool.query<{ id: string }>(
      `SELECT id FROM practice_attempts WHERE section_id = $1 AND user_id = $2 AND status = 'in_progress'
         AND deadline_at IS NOT NULL AND now() > deadline_at + make_interval(secs => $3)`,
      [sectionId, userId, DEADLINE_GRACE_SECONDS],
    );
    for (const row of expired.rows) await settleExpired(row.id);
  }

  /** Finishes a timed attempt whose deadline has passed. Returns whether it did. Race-safe. */
  async function settleExpired(attemptId: string) {
    const settled = await pool.query(
      `UPDATE practice_attempts AS a
       SET status = 'finished', finish_reason = 'time_up', finished_at = a.deadline_at,
           correct_count = (SELECT count(*)::int FROM practice_answers AS x WHERE x.attempt_id = a.id AND x.is_correct)
       WHERE a.id = $1 AND a.status = 'in_progress' AND a.deadline_at IS NOT NULL
         AND now() > a.deadline_at + make_interval(secs => $2)`,
      [attemptId, DEADLINE_GRACE_SECONDS],
    );
    return (settled.rowCount ?? 0) > 0;
  }

  async function attemptState(attempt: { id: string; question_ids: string[]; status: string; correct_count: number | null }) {
    const answers = await pool.query<{ question_id: string; selected: string; is_correct: boolean }>(
      "SELECT question_id, selected, is_correct FROM practice_answers WHERE attempt_id = $1",
      [attempt.id],
    );
    const answered = new Map(answers.rows.map((a) => [a.question_id, a]));
    const nextId = attempt.question_ids.find((id) => !answered.has(id)) ?? null;
    return { answered, nextId };
  }

  function tallyByCategory(questions: QuestionRow[], answered: Map<string, { is_correct: boolean }>) {
    const byCategory = new Map<string, { category: string; field: string; questions: number; answered: number; correct: number }>();
    for (const q of questions) {
      const entry = byCategory.get(q.category) ?? { category: q.category, field: q.field, questions: 0, answered: 0, correct: 0 };
      entry.questions += 1;
      const a = answered.get(q.id);
      if (a) {
        entry.answered += 1;
        if (a.is_correct) entry.correct += 1;
      }
      byCategory.set(q.category, entry);
    }
    return [...byCategory.values()];
  }

  app.get("/api/sections/:sectionId/practice/attempts/:attemptId", perUser, async (request, reply) => {
    const loaded = await loadAttempt(request, reply, false);
    if (!loaded) return;
    const { attempt } = loaded;
    const { answered, nextId } = await attemptState(attempt);
    const body: Record<string, unknown> = {
      attempt: {
        id: attempt.id,
        mode: attempt.mode,
        examId: attempt.exam_session_id,
        category: attempt.category,
        lang: attempt.lang,
        status: attempt.status,
        questionCount: attempt.question_ids.length,
        answeredCount: answered.size,
        correctCount: [...answered.values()].filter((a) => a.is_correct).length,
        startedAt: attempt.started_at,
        finishedAt: attempt.finished_at,
        timeLimitSeconds: attempt.time_limit_seconds,
        deadlineAt: attempt.deadline_at,
        finishReason: attempt.finish_reason,
        assignmentId: attempt.practice_assignment_id,
      },
      serverNow: new Date(),
    };
    // A key is shown in a review unless it is locked for this caller. An assignment's own review
    // follows its review policy instead: after submission, or only once it is due (or closed).
    let showKey = (id: string) => !loaded.ctx.locked.has(id);
    if (attempt.practice_assignment_id) {
      const a = (await pool.query<{ title: string; review_policy: string; due_at: Date | null; status: string; time_limit_seconds: number | null }>(
        "SELECT title, review_policy, due_at, status, time_limit_seconds FROM practice_assignments WHERE id = $1",
        [attempt.practice_assignment_id],
      )).rows[0];
      const opensAt = a ? assignmentReviewOpensAt(a) : null;
      const reviewOpen = Boolean(a) && (
        loaded.ctx.staff || a!.review_policy === "after_submit" || a!.status === "closed" || (opensAt !== null && opensAt <= new Date())
      );
      showKey = () => reviewOpen;
      body.assignment = a ? { title: a.title, reviewPolicy: a.review_policy, dueAt: a.due_at, reviewOpensAt: opensAt, reviewOpen } : null;
    }
    if (attempt.mode === "exam") {
      if (attempt.status === "in_progress") {
        // The whole paper, without keys: the learner's current selections and flags only.
        if (loaded.isOwner) {
          const questions = await loadQuestions(attempt.question_ids);
          body.questions = questions.map((q) => questionView(q, false));
          body.selections = Object.fromEntries([...answered].map(([id, a]) => [id, a.selected]));
          body.flagged = attempt.flagged_question_ids;
        }
        // Correctness stays hidden until the exam is finished.
        (body.attempt as Record<string, unknown>).correctCount = null;
        return reply.send(body);
      }
      const questions = await loadQuestions(attempt.question_ids);
      // An assignment whose review is not open yet shows the score, not the questions and keys.
      const reviewHidden = Boolean(attempt.practice_assignment_id) && !questions.some((q) => showKey(q.id));
      body.review = reviewHidden ? null : questions.map((q) => ({
        question: questionView(q, showKey(q.id)),
        selected: answered.get(q.id)?.selected ?? null,
        correct: showKey(q.id) ? answered.get(q.id)?.is_correct ?? null : null,
        flagged: attempt.flagged_question_ids.includes(q.id),
        ...(showKey(q.id) ? {} : { locked: true }),
      }));
      body.byCategory = tallyByCategory(questions, answered);
      const exam = attempt.exam_session_id
        ? (await pool.query<{ family: string; categories: { field: string }[]; item_count: number }>("SELECT family, categories, item_count FROM exam_sessions WHERE id = $1", [attempt.exam_session_id])).rows[0]
        : undefined;
      body.result = scoreAttempt(
        questions,
        new Set([...answered].filter(([, a]) => a.is_correct).map(([id]) => id)),
        new Set(answered.keys()),
        // The pass rule is for a whole paper; a drawn set gets scores without a pass estimate.
        exam && questions.length === exam.item_count ? exam.family : null,
        [...new Set((exam?.categories ?? []).map((c) => c.field))],
      );
      return reply.send(body);
    }
    if (attempt.status === "in_progress" && nextId && loaded.isOwner) {
      body.next = questionView((await loadQuestions([nextId]))[0]!, false);
    }
    if (attempt.status === "finished" || !nextId) {
      // The review: every question with the learner's answer and the key, and a per-category tally.
      const questions = await loadQuestions(attempt.question_ids);
      body.review = questions.map((q) => ({
        question: questionView(q, showKey(q.id)),
        selected: answered.get(q.id)?.selected ?? null,
        correct: showKey(q.id) ? answered.get(q.id)?.is_correct ?? null : null,
        ...(showKey(q.id) ? {} : { locked: true }),
      }));
      body.byCategory = tallyByCategory(questions, answered);
    }
    return reply.send(body);
  });

  app.post("/api/sections/:sectionId/practice/attempts/:attemptId/answers", perUser, async (request, reply) => {
    const loaded = await loadAttempt(request, reply, true);
    if (!loaded) return;
    const { attempt } = loaded;
    if (attempt.status !== "in_progress") return reply.code(409).send({ error: "ATTEMPT_FINISHED" });
    if (attempt.mode === "exam") return saveExamAnswer(request, reply, attempt);
    const parsed = answerSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const { answered, nextId } = await attemptState(attempt);
    if (!attempt.question_ids.includes(parsed.data.questionId)) return reply.code(400).send({ error: "NOT_IN_ATTEMPT" });
    if (answered.has(parsed.data.questionId)) return reply.code(409).send({ error: "ALREADY_ANSWERED" });
    if (parsed.data.questionId !== nextId) return reply.code(409).send({ error: "OUT_OF_ORDER" });
    const question = (await loadQuestions([parsed.data.questionId]))[0]!;
    if (!question.options.some((o) => o.label === parsed.data.selected)) return reply.code(400).send({ error: "NOT_AN_OPTION" });
    const correct = parsed.data.selected === question.answer;
    await pool.query("INSERT INTO practice_answers (attempt_id, question_id, selected, is_correct) VALUES ($1, $2, $3, $4)", [
      attempt.id,
      question.id,
      parsed.data.selected,
      correct,
    ]);
    const remaining = attempt.question_ids.filter((id) => id !== question.id && !answered.has(id));
    const next = remaining[0] ? questionView((await loadQuestions([remaining[0]]))[0]!, false) : null;
    // Only an attempt started before an assignment opened can reach a locked question.
    if (loaded.ctx.locked.has(question.id)) return reply.send({ correct: null, answer: null, locked: true, next });
    return reply.send({ correct, answer: question.answer, next });
  });

  /** A mock-exam answer: any question, any order, changeable; saved without revealing correctness. */
  async function saveExamAnswer(request: FastifyRequest, reply: FastifyReply, attempt: { id: string; question_ids: string[] }) {
    const parsed = examAnswerSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const { questionId, selected } = parsed.data;
    if (!attempt.question_ids.includes(questionId)) return reply.code(400).send({ error: "NOT_IN_ATTEMPT" });
    if (selected === null) {
      await pool.query("DELETE FROM practice_answers WHERE attempt_id = $1 AND question_id = $2", [attempt.id, questionId]);
    } else {
      const question = (await loadQuestions([questionId]))[0]!;
      if (!question.options.some((o) => o.label === selected)) return reply.code(400).send({ error: "NOT_AN_OPTION" });
      // The write itself re-checks the deadline, so an answer can never land after it (plus grace).
      const saved = await pool.query(
        `INSERT INTO practice_answers (attempt_id, question_id, selected, is_correct)
         SELECT $1, $2, $3, $4 FROM practice_attempts AS a
         WHERE a.id = $1 AND a.status = 'in_progress'
           AND (a.deadline_at IS NULL OR now() <= a.deadline_at + make_interval(secs => $5))
         ON CONFLICT (attempt_id, question_id) DO UPDATE
           SET selected = EXCLUDED.selected, is_correct = EXCLUDED.is_correct, answered_at = now()`,
        [attempt.id, questionId, selected, selected === question.answer, DEADLINE_GRACE_SECONDS],
      );
      if (!saved.rowCount) {
        await settleExpired(attempt.id);
        return reply.code(409).send({ error: "TIME_UP" });
      }
    }
    const count = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM practice_answers WHERE attempt_id = $1", [attempt.id]);
    return reply.send({ saved: true, answeredCount: count.rows[0]!.n });
  }

  // Flag or unflag a mock-exam question for review (no deadline: flags don't change the score).
  app.post("/api/sections/:sectionId/practice/attempts/:attemptId/flags", perUser, async (request, reply) => {
    const loaded = await loadAttempt(request, reply, true);
    if (!loaded) return;
    const { attempt } = loaded;
    if (attempt.mode !== "exam") return reply.code(400).send({ error: "NOT_AN_EXAM" });
    if (attempt.status !== "in_progress") return reply.code(409).send({ error: "ATTEMPT_FINISHED" });
    const parsed = flagSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    if (!attempt.question_ids.includes(parsed.data.questionId)) return reply.code(400).send({ error: "NOT_IN_ATTEMPT" });
    const updated = await pool.query<{ flagged_question_ids: string[] }>(
      `UPDATE practice_attempts
       SET flagged_question_ids = CASE WHEN $3 THEN array_append(array_remove(flagged_question_ids, $2::uuid), $2::uuid)
                                       ELSE array_remove(flagged_question_ids, $2::uuid) END
       WHERE id = $1 RETURNING flagged_question_ids`,
      [attempt.id, parsed.data.questionId, parsed.data.flagged],
    );
    return reply.send({ flagged: updated.rows[0]!.flagged_question_ids });
  });

  app.post("/api/sections/:sectionId/practice/attempts/:attemptId/finish", perUser, async (request, reply) => {
    const loaded = await loadAttempt(request, reply, true);
    if (!loaded) return;
    const { attempt } = loaded;
    if (attempt.status !== "in_progress") return reply.code(409).send({ error: "ATTEMPT_FINISHED" });
    const { answered } = await attemptState(attempt);
    const correctCount = [...answered.values()].filter((a) => a.is_correct).length;
    const reason = attempt.mode === "exam" ? "submitted" : null;
    const done = await pool.query(
      "UPDATE practice_attempts SET status = 'finished', finished_at = now(), correct_count = $2, finish_reason = $3 WHERE id = $1 AND status = 'in_progress'",
      [attempt.id, correctCount, reason],
    );
    if (!done.rowCount) return reply.code(409).send({ error: "ATTEMPT_FINISHED" });
    return reply.send({ correctCount, answeredCount: answered.size, questionCount: attempt.question_ids.length });
  });

  // The caller's own attempts in this Section, newest first.
  app.get("/api/sections/:sectionId/practice/attempts", async (request, reply) => {
    const ctx = await authorizeSection(request, reply);
    if (!ctx) return;
    await settleExpiredFor(ctx.sectionId, ctx.user.id);
    const result = await pool.query(
      `SELECT a.id, a.mode, a.category, a.status, cardinality(a.question_ids) AS question_count,
              CASE WHEN a.mode = 'exam' AND a.status = 'in_progress' THEN NULL ELSE a.correct_count END AS correct_count,
              a.started_at, a.finished_at, a.deadline_at, a.finish_reason, s.content_id AS exam_content_id, s.title AS exam_title,
              a.practice_assignment_id AS assignment_id, pa.title AS assignment_title,
              (SELECT count(*)::int FROM practice_answers AS x WHERE x.attempt_id = a.id) AS answered_count
       FROM practice_attempts AS a LEFT JOIN exam_sessions AS s ON s.id = a.exam_session_id
       LEFT JOIN practice_assignments AS pa ON pa.id = a.practice_assignment_id
       WHERE a.section_id = $1 AND a.user_id = $2 ORDER BY a.started_at DESC LIMIT 50`,
      [ctx.sectionId, ctx.user.id],
    );
    return reply.send({ attempts: result.rows });
  });

  // --- Bookmarks (the caller's own, in this Section) ---
  app.get("/api/sections/:sectionId/practice/bookmarks", async (request, reply) => {
    const ctx = await authorizeSection(request, reply);
    if (!ctx) return;
    const rows = await pool.query<{ question_id: string }>(
      "SELECT question_id FROM practice_bookmarks WHERE section_id = $1 AND user_id = $2 ORDER BY created_at",
      [ctx.sectionId, ctx.user.id],
    );
    return reply.send({ questionIds: rows.rows.map((r) => r.question_id) });
  });

  app.post("/api/sections/:sectionId/practice/bookmarks", perUser, async (request, reply) => {
    const ctx = await authorizeSection(request, reply);
    if (!ctx) return;
    const parsed = bookmarkSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const { questionId, bookmarked } = parsed.data;
    if (bookmarked) {
      const added = await pool.query(
        `INSERT INTO practice_bookmarks (section_id, user_id, question_id)
         SELECT $1, $2, id FROM practice_questions WHERE id = $3
         ON CONFLICT DO NOTHING`,
        [ctx.sectionId, ctx.user.id, questionId],
      );
      if (!added.rowCount) {
        const exists = await pool.query("SELECT 1 FROM practice_questions WHERE id = $1", [questionId]);
        if (!exists.rowCount) return reply.code(404).send({ error: "QUESTION_NOT_FOUND" });
      }
    } else {
      await pool.query("DELETE FROM practice_bookmarks WHERE section_id = $1 AND user_id = $2 AND question_id = $3", [ctx.sectionId, ctx.user.id, questionId]);
    }
    const count = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM practice_bookmarks WHERE section_id = $1 AND user_id = $2", [ctx.sectionId, ctx.user.id]);
    return reply.send({ bookmarked, count: count.rows[0]!.n });
  });

  // --- Personal statistics (the caller's own, in this Section) ---
  app.get("/api/sections/:sectionId/practice/stats", async (request, reply) => {
    const ctx = await authorizeSection(request, reply);
    if (!ctx) return;
    await settleExpiredFor(ctx.sectionId, ctx.user.id);
    const args = [ctx.sectionId, ctx.user.id];
    const overall = await pool.query<{ answered: number; correct: number; questions: number }>(
      `SELECT count(*)::int AS answered, count(*) FILTER (WHERE c.is_correct)::int AS correct,
              count(DISTINCT c.question_id)::int AS questions
       FROM (${countedAnswers("$1")}) AS c WHERE c.user_id = $2`,
      args,
    );
    const byCategory = await pool.query<{ field: string; category: string; answered: number; correct: number }>(
      `SELECT q.field, q.category, count(*)::int AS answered, count(*) FILTER (WHERE c.is_correct)::int AS correct
       FROM (${countedAnswers("$1")}) AS c JOIN practice_questions AS q ON q.id = c.question_id
       WHERE c.user_id = $2 GROUP BY q.field, q.category`,
      args,
    );
    // Fields and categories in the catalogue's own order (Strategy, Management, Technology for IP).
    const catalogue = await pool.query<{ categories: { field: string; name: string }[] }>("SELECT categories FROM exam_sessions ORDER BY content_id DESC");
    const fieldRank = new Map<string, number>();
    const categoryRank = new Map<string, number>();
    for (const row of catalogue.rows) {
      for (const c of row.categories) {
        if (!fieldRank.has(c.field)) fieldRank.set(c.field, fieldRank.size);
        if (!categoryRank.has(c.name)) categoryRank.set(c.name, categoryRank.size);
      }
    }
    const last = Number.MAX_SAFE_INTEGER;
    byCategory.rows.sort(
      (a, b) =>
        (fieldRank.get(a.field) ?? last) - (fieldRank.get(b.field) ?? last) ||
        (categoryRank.get(a.category) ?? last) - (categoryRank.get(b.category) ?? last) ||
        a.category.localeCompare(b.category),
    );
    const exams = await pool.query<{ id: string; finished_at: Date; finish_reason: string; content_id: string; title: string; family: string; categories: { field: string }[]; item_count: number }>(
      `SELECT a.id, a.finished_at, a.finish_reason, s.content_id, s.title, s.family, s.categories, s.item_count
       FROM practice_attempts AS a JOIN exam_sessions AS s ON s.id = a.exam_session_id
       WHERE a.section_id = $1 AND a.user_id = $2 AND a.mode = 'exam' AND a.status = 'finished'
       ORDER BY a.finished_at`,
      args,
    );
    const fieldRows = await pool.query<{ id: string; field: string; questions: number; correct: number }>(
      `SELECT a.id, q.field, count(*)::int AS questions, count(x.question_id) FILTER (WHERE x.is_correct)::int AS correct
       FROM practice_attempts AS a
       CROSS JOIN LATERAL unnest(a.question_ids) AS qid
       JOIN practice_questions AS q ON q.id = qid
       LEFT JOIN practice_answers AS x ON x.attempt_id = a.id AND x.question_id = qid
       WHERE a.section_id = $1 AND a.user_id = $2 AND a.mode = 'exam' AND a.status = 'finished'
       GROUP BY a.id, q.field`,
      args,
    );
    const fieldsOf = new Map<string, { field: string; questions: number; correct: number }[]>();
    for (const r of fieldRows.rows) fieldsOf.set(r.id, [...(fieldsOf.get(r.id) ?? []), { field: r.field, questions: r.questions, correct: r.correct }]);
    const trend = exams.rows.map((e) => {
      const order = [...new Set(e.categories.map((c) => c.field))];
      const rank = (f: string) => (order.includes(f) ? order.indexOf(f) : order.length);
      const fields = (fieldsOf.get(e.id) ?? []).sort((a, b) => rank(a.field) - rank(b.field));
      const correct = fields.reduce((n, f) => n + f.correct, 0);
      const questions = fields.reduce((n, f) => n + f.questions, 0);
      return {
        attemptId: e.id,
        finishedAt: e.finished_at,
        finishReason: e.finish_reason,
        examContentId: e.content_id,
        examTitle: e.title,
        correct,
        questions,
        fields,
        pass: questions === e.item_count ? passFromFieldTotals(fields, e.family) : null,
      };
    });
    const bookmarks = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM practice_bookmarks WHERE section_id = $1 AND user_id = $2", args);
    // Locked questions are left out of the mistakes quiz, so leave them out of its count too.
    const mistakes = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (${mistakeIds("$1", "$2")}) AS m WHERE NOT (m.question_id = ANY($3::uuid[]))`,
      [...args, [...ctx.locked]],
    );
    return reply.send({
      overall: overall.rows[0],
      byCategory: byCategory.rows,
      examTrend: trend,
      bookmarkCount: bookmarks.rows[0]!.n,
      mistakeCount: mistakes.rows[0]!.n,
    });
  });

  // --- Most-missed questions in this Section (anonymous; every member sees it) ---
  app.get("/api/sections/:sectionId/practice/most-missed", async (request, reply) => {
    const ctx = await authorizeSection(request, reply);
    if (!ctx) return;
    const query = mostMissedQuery.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error);
    const params: unknown[] = [ctx.sectionId, MOST_MISSED_MIN_ANSWERS, MOST_MISSED_MIN_LEARNERS, query.data.limit];
    let examFilter = "";
    if (query.data.examId) {
      params.push(query.data.examId);
      examFilter = `AND q.exam_session_id = $${params.length}`;
    }
    if (ctx.locked.size) {
      params.push([...ctx.locked]);
      examFilter += ` AND NOT (c.question_id = ANY($${params.length}::uuid[]))`;
    }
    const ranked = await pool.query<{ question_id: string; answers: number; correct: number }>(
      `SELECT c.question_id, count(*)::int AS answers, count(*) FILTER (WHERE c.is_correct)::int AS correct
       FROM (${countedAnswers("$1")}) AS c JOIN practice_questions AS q ON q.id = c.question_id
       WHERE true ${examFilter}
       GROUP BY c.question_id
       HAVING count(*) >= $2 AND count(DISTINCT c.user_id) >= $3
       ORDER BY count(*) FILTER (WHERE c.is_correct)::float / count(*), count(*) DESC, c.question_id
       LIMIT $4`,
      params,
    );
    const questions = await loadQuestions(ranked.rows.map((r) => r.question_id));
    const stats = new Map(ranked.rows.map((r) => [r.question_id, r]));
    return reply.send({
      minAnswers: MOST_MISSED_MIN_ANSWERS,
      minLearners: MOST_MISSED_MIN_LEARNERS,
      questions: questions.map((q) => ({ question: questionView(q, true), answers: stats.get(q.id)!.answers, correct: stats.get(q.id)!.correct })),
    });
  });

  // --- Figures: any signed-in user. They are ITPEC-released exam figures, served from the
  // database because app/ is public; `private` caching keeps them off shared caches. ---
  app.get("/api/practice/figures/:figureId", async (request, reply) => {
    const user: AuthenticatedUser | null = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { figureId } = request.params as { figureId: string };
    if (!/^[0-9A-Za-z_-]{1,80}$/.test(figureId)) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const figure = await pool.query<{ mime: string; data: Buffer; sha256: string }>("SELECT mime, data, sha256 FROM practice_figures WHERE id = $1", [figureId]);
    const row = figure.rows[0];
    if (!row) return reply.code(404).send({ error: "FIGURE_NOT_FOUND" });
    return reply
      .type(row.mime)
      .header("cache-control", "private, max-age=86400")
      .header("etag", `"${row.sha256}"`)
      .header("x-content-type-options", "nosniff")
      .send(row.data);
  });
}
