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

const idSchema = z.uuid();
const startSchema = z.object({
  mode: z.enum(["practice", "quiz"]),
  examId: z.uuid().nullable().optional(),
  category: z.string().trim().min(1).max(100).nullable().optional(),
  lang: z.enum(["en", "th"]).default("en"),
  count: z.number().int().min(1).max(100).default(10),
});
const answerSchema = z.object({ questionId: z.uuid(), selected: z.string().regex(/^[a-z]$/) });
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

  /** A Section member; students only while practice is enabled, staff (and admins) always. */
  async function authorizeSection(request: FastifyRequest, reply: FastifyReply) {
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
    if (!staff && !enabled) {
      await reply.code(403).send({ error: "PRACTICE_NOT_ENABLED" });
      return null;
    }
    return { user, sectionId, staff, enabled, roles };
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
    return reply.send({ total: total.rows[0]!.n, offset, limit, questions: rows.rows.map((q) => questionView(q, true)) });
  });

  // --- Start a practice run or a quick quiz ---
  app.post("/api/sections/:sectionId/practice/attempts", perUser, async (request, reply) => {
    const ctx = await authorizeSection(request, reply);
    if (!ctx) return;
    const parsed = startSchema.safeParse(request.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const { mode, examId, category, lang, count } = parsed.data;
    if (mode === "practice" && !examId) return reply.code(400).send({ error: "EXAM_REQUIRED" });
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
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    // Practice walks the session in order; a quick quiz draws `count` at random.
    const order = mode === "practice" ? "ORDER BY seq" : `ORDER BY random() LIMIT ${count}`;
    const picked = await pool.query<{ id: string }>(`SELECT id FROM practice_questions ${where} ${order}`, params);
    if (!picked.rowCount) return reply.code(400).send({ error: "NO_QUESTIONS" });
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO practice_attempts (user_id, section_id, mode, exam_session_id, category, lang, question_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[]) RETURNING id`,
      [ctx.user.id, ctx.sectionId, mode, examId ?? null, category ?? null, lang, picked.rows.map((r) => r.id)],
    );
    return reply.code(201).send({ attemptId: inserted.rows[0]!.id, questionCount: picked.rowCount });
  });

  async function loadAttempt(request: FastifyRequest, reply: FastifyReply, ownerOnly: boolean) {
    const ctx = await authorizeSection(request, reply);
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
    }>("SELECT * FROM practice_attempts WHERE id = $1 AND section_id = $2", [attemptId, ctx.sectionId]);
    const attempt = result.rows[0];
    if (!attempt) {
      await reply.code(404).send({ error: "ATTEMPT_NOT_FOUND" });
      return null;
    }
    const isOwner = attempt.user_id === ctx.user.id;
    if (!isOwner && (ownerOnly || !ctx.staff)) {
      await reply.code(403).send({ error: "FORBIDDEN" });
      return null;
    }
    return { ctx, attempt, isOwner };
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
      },
    };
    if (attempt.status === "in_progress" && nextId && loaded.isOwner) {
      body.next = questionView((await loadQuestions([nextId]))[0]!, false);
    }
    if (attempt.status === "finished" || !nextId) {
      // The review: every question with the learner's answer and the key, and a per-category tally.
      const questions = await loadQuestions(attempt.question_ids);
      body.review = questions.map((q) => ({ question: questionView(q, true), selected: answered.get(q.id)?.selected ?? null, correct: answered.get(q.id)?.is_correct ?? null }));
      const byCategory = new Map<string, { category: string; field: string; answered: number; correct: number }>();
      for (const q of questions) {
        const entry = byCategory.get(q.category) ?? { category: q.category, field: q.field, answered: 0, correct: 0 };
        const a = answered.get(q.id);
        if (a) {
          entry.answered += 1;
          if (a.is_correct) entry.correct += 1;
        }
        byCategory.set(q.category, entry);
      }
      body.byCategory = [...byCategory.values()];
    }
    return reply.send(body);
  });

  app.post("/api/sections/:sectionId/practice/attempts/:attemptId/answers", perUser, async (request, reply) => {
    const loaded = await loadAttempt(request, reply, true);
    if (!loaded) return;
    const { attempt } = loaded;
    if (attempt.status !== "in_progress") return reply.code(409).send({ error: "ATTEMPT_FINISHED" });
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
    return reply.send({ correct, answer: question.answer, next });
  });

  app.post("/api/sections/:sectionId/practice/attempts/:attemptId/finish", perUser, async (request, reply) => {
    const loaded = await loadAttempt(request, reply, true);
    if (!loaded) return;
    const { attempt } = loaded;
    if (attempt.status !== "in_progress") return reply.code(409).send({ error: "ATTEMPT_FINISHED" });
    const { answered } = await attemptState(attempt);
    const correctCount = [...answered.values()].filter((a) => a.is_correct).length;
    await pool.query("UPDATE practice_attempts SET status = 'finished', finished_at = now(), correct_count = $2 WHERE id = $1", [attempt.id, correctCount]);
    return reply.send({ correctCount, answeredCount: answered.size, questionCount: attempt.question_ids.length });
  });

  // The caller's own attempts in this Section, newest first.
  app.get("/api/sections/:sectionId/practice/attempts", async (request, reply) => {
    const ctx = await authorizeSection(request, reply);
    if (!ctx) return;
    const result = await pool.query(
      `SELECT a.id, a.mode, a.category, a.status, cardinality(a.question_ids) AS question_count, a.correct_count,
              a.started_at, a.finished_at, s.content_id AS exam_content_id, s.title AS exam_title,
              (SELECT count(*)::int FROM practice_answers AS x WHERE x.attempt_id = a.id) AS answered_count
       FROM practice_attempts AS a LEFT JOIN exam_sessions AS s ON s.id = a.exam_session_id
       WHERE a.section_id = $1 AND a.user_id = $2 ORDER BY a.started_at DESC LIMIT 50`,
      [ctx.sectionId, ctx.user.id],
    );
    return reply.send({ attempts: result.rows });
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
