// Learning activities: server-scored games attached to a Section. See
// personalschema:work/projects/personal/engineering/ClassOps/classops-learning-games-development-plan.md
//
// The browser never sees a package's answer keys, option/row ids, or the attempt seed: every
// item goes out through engine.projectItem() and comes back as tokens that only the server can
// resolve. Evidence and exports are Section-manager-only; a learner only ever reads their own
// attempts.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  ActivityAnswerError,
  aggregate,
  BAND_EPSILON,
  correctAnswer,
  itemFeedback,
  listItems,
  localize,
  newSeed,
  packageHash,
  projectItem,
  projectStage,
  SCORER_VERSION,
  scoreItem,
  type ActivityPackage,
  type Lang,
} from "../activities/engine.js";
import { canManageSessions, getSectionRoles, type AuthenticatedUser, type MembershipRole } from "../authz.js";
import type { AppConfig } from "../config.js";
import { toCsv } from "../csv.js";
import { requireCurrentUser } from "../current-user.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "../db.js";
import { sessionRateLimitKey } from "../rate-limit-key.js";

const idSchema = z.uuid();
const langSchema = z.enum(["th", "en"]);
const isoDate = z.iso.datetime({ offset: true });
const createSchema = z.object({
  packageId: z.uuid(),
  status: z.enum(["draft", "open", "closed"]).optional(),
  opensAt: isoDate.nullable().optional(),
  dueAt: isoDate.nullable().optional(),
  maxAttempts: z.number().int().positive().nullable().optional(),
  evidencePolicy: z.enum(["first", "best", "last", "mean"]).optional(),
});
const updateSchema = createSchema.omit({ packageId: true }).extend({
  // The gradebook assignment a teacher-triggered sync writes to (same Section), or null to unlink.
  assignmentId: z.uuid().nullable().optional(),
});
const syncSchema = z.object({
  // Learners whose hand-edited cell the teacher explicitly chose to overwrite (preview status "manual").
  overwriteUserIds: z.array(z.uuid()).max(2000).default([]),
});
const startSchema = z.object({ lang: langSchema.optional() });
const responseSchema = z.object({
  itemKey: z.string().min(1).max(64),
  answer: z.record(z.string(), z.unknown()),
});

// Game play is one request per item. These learner-facing routes get their own per-user bucket
// (same verified-session key as the app-wide limiter, see rate-limit-key.ts), separate from the
// app-wide 100/min, so answering items never starves page loads and vice versa.
const PER_USER_LIMIT = 60;

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

interface SectionActivityRow {
  id: string;
  section_id: string;
  package_id: string;
  status: "draft" | "open" | "closed";
  opens_at: Date | null;
  due_at: Date | null;
  max_attempts: number | null;
  evidence_policy: EvidencePolicy;
  assignment_id: string | null;
  created_at: Date;
  updated_at: Date;
  slug: string;
  version: number;
  title: ActivityPackage["title"];
  languages: Lang[];
}

interface AttemptRow {
  id: string;
  section_activity_id: string;
  user_id: string;
  package_id: string;
  attempt_no: number;
  shuffle_seed: string;
  lang: Lang;
  status: "in_progress" | "finished" | "abandoned";
  started_at: Date;
  finished_at: Date | null;
  score_ratio: string | null;
  band_index: number | null;
  stage_results: Record<string, number> | null;
  scorer_version: string;
}

const ACTIVITY_COLUMNS = `activity.id, activity.section_id, activity.package_id, activity.status,
  activity.opens_at, activity.due_at, activity.max_attempts, activity.evidence_policy, activity.assignment_id,
  activity.created_at, activity.updated_at, package.slug, package.version, package.title,
  package.languages`;

function publicActivity(row: SectionActivityRow) {
  return {
    id: row.id,
    sectionId: row.section_id,
    packageId: row.package_id,
    slug: row.slug,
    version: row.version,
    title: row.title,
    languages: row.languages,
    status: row.status,
    opensAt: row.opens_at,
    dueAt: row.due_at,
    maxAttempts: row.max_attempts,
    evidencePolicy: row.evidence_policy,
    assignmentId: row.assignment_id,
    availableNow: isAvailable(row),
  };
}

function isAvailable(row: Pick<SectionActivityRow, "status" | "opens_at" | "due_at">, now = new Date()) {
  if (row.status !== "open") return false;
  if (row.opens_at && row.opens_at > now) return false;
  if (row.due_at && row.due_at <= now) return false;
  return true;
}

function attemptSummary(row: AttemptRow) {
  return {
    id: row.id,
    attemptNo: row.attempt_no,
    lang: row.lang,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    scoreRatio: row.score_ratio === null ? null : Number(row.score_ratio),
    bandIndex: row.band_index,
  };
}

function bandView(pkg: ActivityPackage, index: number, lang: Lang) {
  const band = pkg.bands[index];
  if (!band) return null;
  return {
    index,
    badge: band.badge ?? null,
    title: localize(band.title, lang) ?? null,
    description: localize(band.description, lang) ?? null,
  };
}

type EvidencePolicy = "first" | "best" | "last" | "mean";

/** Pick one attempt among finished attempts (ordered by attempt_no). */
function pickAttempt(finished: AttemptRow[], policy: "first" | "best" | "last") {
  if (finished.length === 0) return null;
  if (policy === "first") return finished[0] ?? null;
  if (policy === "last") return finished[finished.length - 1] ?? null;
  return finished.reduce((best, a) => (Number(a.score_ratio) > Number(best.score_ratio) ? a : best));
}

/** The band a score falls in, by the same rule as the engine's aggregate(). */
function bandIndexFor(pkg: ActivityPackage, scoreRatio: number) {
  const index = pkg.bands.findIndex((b) => scoreRatio * 100 + BAND_EPSILON >= b.min_percent);
  return index === -1 ? null : index;
}

/**
 * The evidence score under the activity's policy, or null with no finished attempt. `first`,
 * `best`, and `last` count one attempt (attemptId set); `mean` averages every finished attempt
 * (attemptId null, attemptCount the number averaged).
 */
function evidenceOf(pkg: ActivityPackage, finished: AttemptRow[], policy: EvidencePolicy) {
  if (finished.length === 0) return null;
  if (policy === "mean") {
    const scoreRatio = finished.reduce((sum, a) => sum + Number(a.score_ratio), 0) / finished.length;
    return { policy, scoreRatio, bandIndex: bandIndexFor(pkg, scoreRatio), attemptId: null, attemptCount: finished.length };
  }
  const chosen = pickAttempt(finished, policy) as AttemptRow;
  return {
    policy,
    scoreRatio: Number(chosen.score_ratio),
    bandIndex: chosen.band_index,
    attemptId: chosen.id,
    attemptCount: 1,
  };
}

/** Gradebook points for a ratio: two decimals, as a teacher would type them. */
function pointsFor(scoreRatio: number, maxPoints: number) {
  return Math.round(scoreRatio * maxPoints * 100) / 100;
}

export async function registerActivityRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;
  const perUser = {
    config: {
      rateLimit: {
        max: PER_USER_LIMIT,
        timeWindow: "1 minute",
        keyGenerator: sessionRateLimitKey(pool, config),
      },
    },
  };

  async function rolesFor(user: AuthenticatedUser, sectionId: string): Promise<MembershipRole[]> {
    return getSectionRoles(pool, user.id, sectionId);
  }
  const isManager = (user: AuthenticatedUser, roles: MembershipRole[]) => user.isPlatformAdmin || canManageSessions(roles);

  async function loadActivity(id: string) {
    const result = await pool.query<SectionActivityRow>(
      `SELECT ${ACTIVITY_COLUMNS}
       FROM section_activities AS activity
       JOIN activity_packages AS package ON package.id = activity.package_id
       WHERE activity.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async function loadSpec(packageId: string) {
    const result = await pool.query<{ spec: ActivityPackage }>("SELECT spec FROM activity_packages WHERE id = $1", [
      packageId,
    ]);
    const spec = result.rows[0]?.spec;
    if (!spec) throw new Error(`activity package ${packageId} is missing`);
    return spec;
  }

  async function loadAttempt(id: string) {
    const result = await pool.query<AttemptRow>("SELECT * FROM activity_attempts WHERE id = $1", [id]);
    return result.rows[0] ?? null;
  }

  async function itemRatios(attemptId: string, db: DatabasePool | DatabaseClient = pool) {
    const result = await db.query<{ item_key: string; ratio: string; flags: string[]; submitted_at: Date }>(
      "SELECT item_key, ratio, flags, submitted_at FROM activity_responses WHERE attempt_id = $1 ORDER BY submitted_at",
      [attemptId],
    );
    return result.rows;
  }

  function nextItemKey(pkg: ActivityPackage, answered: Set<string>) {
    return listItems(pkg).find(({ item }) => !answered.has(item.key))?.item.key ?? null;
  }

  function playState(pkg: ActivityPackage, attempt: AttemptRow, answered: Set<string>) {
    const next = nextItemKey(pkg, answered);
    return {
      next: next ? projectItem(pkg, next, attempt.shuffle_seed, attempt.lang) : null,
      progress: { answered: answered.size, total: listItems(pkg).length },
    };
  }

  function activityHeader(pkg: ActivityPackage, lang: Lang) {
    return {
      title: localize(pkg.title, lang) ?? null,
      languages: pkg.languages,
      reveal: pkg.reveal,
      stages: pkg.stages.map((s) => projectStage(pkg, s.key, lang)),
    };
  }

  /** Owner-or-manager access to one attempt; sends the error reply and returns null when denied. */
  async function authorizeAttempt(request: FastifyRequest, reply: FastifyReply, ownerOnly: boolean) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    const { attemptId } = request.params as { attemptId: string };
    if (!idSchema.safeParse(attemptId).success) {
      await reply.code(400).send({ error: "INVALID_REQUEST" });
      return null;
    }
    const attempt = await loadAttempt(attemptId);
    if (!attempt) {
      await reply.code(404).send({ error: "ATTEMPT_NOT_FOUND" });
      return null;
    }
    const activity = await loadActivity(attempt.section_activity_id);
    if (!activity) {
      await reply.code(404).send({ error: "ACTIVITY_NOT_FOUND" });
      return null;
    }
    const isOwner = attempt.user_id === user.id;
    if (!isOwner) {
      const allowed = !ownerOnly && isManager(user, await rolesFor(user, activity.section_id));
      if (!allowed) {
        await reply.code(403).send({ error: "FORBIDDEN" });
        return null;
      }
    }
    return { user, attempt, activity, isOwner };
  }

  // Catalog of imported packages, for staff choosing what to attach. Never includes `spec`.
  app.get("/api/activity-packages", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    if (!user.isPlatformAdmin) {
      const managed = await pool.query(
        "SELECT 1 FROM memberships WHERE user_id = $1 AND roles && ARRAY['owner', 'teacher', 'ta'] LIMIT 1",
        [user.id],
      );
      if (!managed.rowCount) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const result = await pool.query(
      `SELECT id, slug, version, title, languages, imported_at,
              (SELECT count(*)::int FROM jsonb_array_elements(spec->'stages') AS stage,
                                         jsonb_array_elements(stage->'items')) AS item_count
       FROM activity_packages ORDER BY slug, version DESC`,
    );
    return reply.send({
      packages: result.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        version: row.version,
        title: row.title,
        languages: row.languages,
        itemCount: row.item_count,
        importedAt: row.imported_at,
      })),
    });
  });

  app.get("/api/sections/:sectionId/activities", perUser, async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    if (!idSchema.safeParse(sectionId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const roles = await rolesFor(user, sectionId);
    if (!user.isPlatformAdmin && roles.length === 0) return reply.code(403).send({ error: "FORBIDDEN" });
    const manager = isManager(user, roles);
    const result = await pool.query<SectionActivityRow>(
      `SELECT ${ACTIVITY_COLUMNS}
       FROM section_activities AS activity
       JOIN activity_packages AS package ON package.id = activity.package_id
       WHERE activity.section_id = $1 ${manager ? "" : "AND activity.status <> 'draft'"}
       ORDER BY activity.created_at`,
      [sectionId],
    );
    const mine = await pool.query<AttemptRow>(
      `SELECT attempt.* FROM activity_attempts AS attempt
       JOIN section_activities AS activity ON activity.id = attempt.section_activity_id
       WHERE activity.section_id = $1 AND attempt.user_id = $2
       ORDER BY attempt.attempt_no`,
      [sectionId, user.id],
    );
    return reply.send({
      activities: result.rows.map((row) => ({
        ...publicActivity(row),
        myAttempts: mine.rows.filter((a) => a.section_activity_id === row.id).map(attemptSummary),
      })),
    });
  });

  app.post("/api/sections/:sectionId/activities", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    if (!idSchema.safeParse(sectionId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    if (!isManager(user, await rolesFor(user, sectionId))) return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const body = parsed.data;
    const section = await pool.query("SELECT 1 FROM sections WHERE id = $1", [sectionId]);
    if (!section.rowCount) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    const pkg = await pool.query("SELECT 1 FROM activity_packages WHERE id = $1", [body.packageId]);
    if (!pkg.rowCount) return reply.code(404).send({ error: "PACKAGE_NOT_FOUND" });
    if (body.opensAt && body.dueAt && new Date(body.dueAt) <= new Date(body.opensAt)) {
      return reply.code(400).send({ error: "INVALID_SCHEDULE" });
    }
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO section_activities
         (section_id, package_id, status, opens_at, due_at, max_attempts, evidence_policy, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        sectionId,
        body.packageId,
        body.status ?? "draft",
        body.opensAt ?? null,
        body.dueAt ?? null,
        body.maxAttempts ?? null,
        body.evidencePolicy ?? "first",
        user.id,
      ],
    );
    const row = await loadActivity(inserted.rows[0]?.id as string);
    return reply.code(201).send({ activity: row ? publicActivity(row) : null });
  });

  app.patch("/api/section-activities/:activityId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { activityId } = request.params as { activityId: string };
    if (!idSchema.safeParse(activityId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const activity = await loadActivity(activityId);
    if (!activity) return reply.code(404).send({ error: "ACTIVITY_NOT_FOUND" });
    if (!isManager(user, await rolesFor(user, activity.section_id))) return reply.code(403).send({ error: "FORBIDDEN" });
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const body = parsed.data;
    if (body.assignmentId) {
      const sameSection = await pool.query(
        `SELECT 1 FROM assignments AS assignment
         JOIN categories AS category ON category.id = assignment.category_id
         WHERE assignment.id = $1 AND category.section_id = $2`,
        [body.assignmentId, activity.section_id],
      );
      if (!sameSection.rowCount) return reply.code(400).send({ error: "ASSIGNMENT_NOT_IN_SECTION" });
    }
    const opensAt = body.opensAt === undefined ? activity.opens_at : body.opensAt === null ? null : new Date(body.opensAt);
    const dueAt = body.dueAt === undefined ? activity.due_at : body.dueAt === null ? null : new Date(body.dueAt);
    if (opensAt && dueAt && dueAt <= opensAt) return reply.code(400).send({ error: "INVALID_SCHEDULE" });
    await pool.query(
      `UPDATE section_activities
       SET status = $2, opens_at = $3, due_at = $4, max_attempts = $5, evidence_policy = $6,
           assignment_id = $7, updated_at = now()
       WHERE id = $1`,
      [
        activityId,
        body.status ?? activity.status,
        opensAt,
        dueAt,
        body.maxAttempts === undefined ? activity.max_attempts : body.maxAttempts,
        body.evidencePolicy ?? activity.evidence_policy,
        body.assignmentId === undefined ? activity.assignment_id : body.assignmentId,
      ],
    );
    const row = await loadActivity(activityId);
    return reply.send({ activity: row ? publicActivity(row) : null });
  });

  // Starts (or resumes) the caller's attempt. Only learners with the `student` role play.
  app.post("/api/section-activities/:activityId/attempts", perUser, async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { activityId } = request.params as { activityId: string };
    if (!idSchema.safeParse(activityId).success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const parsed = startSchema.safeParse(request.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const activity = await loadActivity(activityId);
    if (!activity) return reply.code(404).send({ error: "ACTIVITY_NOT_FOUND" });
    const roles = await rolesFor(user, activity.section_id);
    if (!roles.includes("student")) return reply.code(403).send({ error: "FORBIDDEN" });
    if (activity.status === "draft") return reply.code(404).send({ error: "ACTIVITY_NOT_FOUND" });
    const pkg = await loadSpec(activity.package_id);

    const open = await pool.query<AttemptRow>(
      "SELECT * FROM activity_attempts WHERE section_activity_id = $1 AND user_id = $2 AND status = 'in_progress'",
      [activityId, user.id],
    );
    let attempt = open.rows[0] ?? null;
    let resumed = true;
    if (!attempt) {
      if (!isAvailable(activity)) return reply.code(409).send({ error: "ACTIVITY_NOT_AVAILABLE" });
      const lang = parsed.data.lang ?? pkg.languages[0] ?? "en";
      if (!pkg.languages.includes(lang)) return reply.code(400).send({ error: "LANGUAGE_NOT_AVAILABLE" });
      const count = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM activity_attempts WHERE section_activity_id = $1 AND user_id = $2",
        [activityId, user.id],
      );
      const used = count.rows[0]?.n ?? 0;
      if (activity.max_attempts !== null && used >= activity.max_attempts) {
        return reply.code(409).send({ error: "ATTEMPT_LIMIT_REACHED" });
      }
      try {
        const inserted = await pool.query<AttemptRow>(
          `INSERT INTO activity_attempts
             (section_activity_id, user_id, package_id, attempt_no, shuffle_seed, lang, scorer_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [activityId, user.id, activity.package_id, used + 1, newSeed(), lang, SCORER_VERSION],
        );
        attempt = inserted.rows[0] ?? null;
        resumed = false;
      } catch (error) {
        // A concurrent start from the same learner (double click, two tabs) lost the
        // one-open-attempt race: hand back the attempt the winner created, as a resume.
        if ((error as { code?: string }).code !== "23505") throw error;
        const winner = await pool.query<AttemptRow>(
          "SELECT * FROM activity_attempts WHERE section_activity_id = $1 AND user_id = $2 AND status = 'in_progress'",
          [activityId, user.id],
        );
        attempt = winner.rows[0] ?? null;
        if (!attempt) return reply.code(409).send({ error: "ATTEMPT_IN_PROGRESS" });
      }
    }
    if (!attempt) throw new Error("attempt insert returned no row");
    const answered = new Set((await itemRatios(attempt.id)).map((r) => r.item_key));
    return reply.code(resumed ? 200 : 201).send({
      attempt: attemptSummary(attempt),
      resumed,
      activity: activityHeader(pkg, attempt.lang),
      ...playState(pkg, attempt, answered),
    });
  });

  app.post("/api/activity-attempts/:attemptId/responses", perUser, async (request, reply) => {
    const ctx = await authorizeAttempt(request, reply, true);
    if (!ctx) return;
    const { attempt, activity } = ctx;
    const parsed = responseSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    if (!isAvailable(activity)) return reply.code(409).send({ error: "ACTIVITY_NOT_AVAILABLE" });
    const pkg = await loadSpec(attempt.package_id);

    // The attempt row is locked for the whole check-score-insert, so answers are serialized and
    // a concurrent finish can never compute a score that misses a just-accepted answer.
    const outcome = await withTransaction(pool, async (client) => {
      const locked = await client.query<{ status: AttemptRow["status"] }>(
        "SELECT status FROM activity_attempts WHERE id = $1 FOR UPDATE",
        [attempt.id],
      );
      if (locked.rows[0]?.status !== "in_progress") return { code: 409, body: { error: "ATTEMPT_NOT_IN_PROGRESS" } };
      const answered = new Set((await itemRatios(attempt.id, client)).map((r) => r.item_key));
      const expected = nextItemKey(pkg, answered);
      if (expected === null) return { code: 409, body: { error: "ALL_ITEMS_ANSWERED" } };
      if (parsed.data.itemKey !== expected) return { code: 409, body: { error: "ITEM_OUT_OF_ORDER", expected } };
      let score;
      try {
        score = scoreItem(pkg, expected, parsed.data.answer, attempt.shuffle_seed);
      } catch (error) {
        if (error instanceof ActivityAnswerError) return { code: 400, body: { error: "INVALID_ANSWER", detail: error.detail } };
        throw error;
      }
      await client.query(
        `INSERT INTO activity_responses (attempt_id, item_key, answer, ratio, flags) VALUES ($1, $2, $3::jsonb, $4, $5)`,
        [attempt.id, expected, JSON.stringify(parsed.data.answer), score.ratio, score.flags],
      );
      answered.add(expected);
      return {
        code: 200,
        body: {
          itemKey: expected,
          feedback: itemFeedback(pkg, expected, score, attempt.shuffle_seed, attempt.lang),
          ...playState(pkg, attempt, answered),
        },
      };
    });
    return reply.code(outcome.code).send(outcome.body);
  });

  app.post("/api/activity-attempts/:attemptId/finish", perUser, async (request, reply) => {
    const ctx = await authorizeAttempt(request, reply, true);
    if (!ctx) return;
    const { attempt } = ctx;
    const pkg = await loadSpec(attempt.package_id);
    const finished = await withTransaction(pool, async (client) => {
      const locked = await client.query<{ status: AttemptRow["status"] }>(
        "SELECT status FROM activity_attempts WHERE id = $1 FOR UPDATE",
        [attempt.id],
      );
      if (locked.rows[0]?.status !== "in_progress") return null;
      const responses = await itemRatios(attempt.id, client);
      const result = aggregate(pkg, Object.fromEntries(responses.map((r) => [r.item_key, Number(r.ratio)])));
      const updated = await client.query<AttemptRow>(
        `UPDATE activity_attempts
         SET status = 'finished', finished_at = now(), score_ratio = $2, band_index = $3, stage_results = $4::jsonb
         WHERE id = $1 RETURNING *`,
        [attempt.id, result.score_ratio, result.band_index, JSON.stringify(result.stage_results)],
      );
      const row = updated.rows[0];
      return row ? { row, result } : null;
    });
    if (!finished) return reply.code(409).send({ error: "ATTEMPT_NOT_IN_PROGRESS" });
    return reply.send({
      attempt: attemptSummary(finished.row),
      result: resultView(pkg, finished.row, finished.result.answered, finished.result.total),
    });
  });

  function resultView(pkg: ActivityPackage, attempt: AttemptRow, answered: number, total: number) {
    return {
      scoreRatio: Number(attempt.score_ratio),
      percent: Number(attempt.score_ratio) * 100,
      band: attempt.band_index === null ? null : bandView(pkg, attempt.band_index, attempt.lang),
      stageResults: attempt.stage_results,
      answered,
      total,
    };
  }

  // Resume or review one attempt: its owner, or a manager of the attempt's Section.
  app.get("/api/activity-attempts/:attemptId", perUser, async (request, reply) => {
    const ctx = await authorizeAttempt(request, reply, false);
    if (!ctx) return;
    const { attempt, isOwner } = ctx;
    const pkg = await loadSpec(attempt.package_id);
    const responses = await itemRatios(attempt.id);
    const body: Record<string, unknown> = {
      attempt: attemptSummary(attempt),
      activity: activityHeader(pkg, attempt.lang),
      responses: responses.map((r) => ({
        itemKey: r.item_key,
        ratio: Number(r.ratio),
        flags: r.flags,
        submittedAt: r.submitted_at,
      })),
    };
    if (attempt.status === "in_progress" && isOwner) {
      Object.assign(body, playState(pkg, attempt, new Set(responses.map((r) => r.item_key))));
    }
    if (attempt.status === "finished") {
      const items = listItems(pkg);
      body.result = resultView(pkg, attempt, responses.length, items.length);
      if (!isOwner) body.verification = await verifyAttempt(attempt, pkg);
      if (isOwner && pkg.reveal !== "none") {
        body.review = items
          .filter(({ item }) => responses.some((r) => r.item_key === item.key))
          .map(({ item }) => ({
            item: projectItem(pkg, item.key, attempt.shuffle_seed, attempt.lang),
            correct: correctAnswer(item, attempt.shuffle_seed),
            explanation: localize(item.explanation, attempt.lang) ?? null,
          }));
      }
    }
    return reply.send(body);
  });

  /**
   * Staff-facing proof of a finished attempt: who it belongs to, the exact package and scorer that
   * produced it, and a fresh re-score of the stored answers with the current engine. `matches` is
   * true when the re-score reproduces every stored item ratio and the stored total.
   */
  async function verifyAttempt(attempt: AttemptRow, pkg: ActivityPackage) {
    const learner = await pool.query<{ display_name: string; student_id: string | null; content_hash: string; slug: string; version: number }>(
      `SELECT app_user.display_name, membership.student_id, package.content_hash, package.slug, package.version
       FROM activity_attempts AS attempt
       JOIN users AS app_user ON app_user.id = attempt.user_id
       JOIN section_activities AS activity ON activity.id = attempt.section_activity_id
       JOIN activity_packages AS package ON package.id = attempt.package_id
       LEFT JOIN memberships AS membership ON membership.user_id = attempt.user_id AND membership.section_id = activity.section_id
       WHERE attempt.id = $1`,
      [attempt.id],
    );
    const info = learner.rows[0];
    const stored = await pool.query<{ item_key: string; answer: unknown; ratio: string }>(
      "SELECT item_key, answer, ratio FROM activity_responses WHERE attempt_id = $1",
      [attempt.id],
    );
    let itemsMatch = true;
    const rescoredRatios: Record<string, number> = {};
    for (const row of stored.rows) {
      let ratio: number;
      try {
        ratio = scoreItem(pkg, row.item_key, row.answer, attempt.shuffle_seed).ratio;
      } catch {
        itemsMatch = false;
        continue;
      }
      rescoredRatios[row.item_key] = ratio;
      if (Math.abs(ratio - Number(row.ratio)) > 1e-9) itemsMatch = false;
    }
    const rescored = aggregate(pkg, rescoredRatios);
    const storedRatio = Number(attempt.score_ratio);
    return {
      learner: { displayName: info?.display_name ?? null, studentId: info?.student_id ?? null },
      package: {
        slug: info?.slug ?? null,
        version: info?.version ?? null,
        contentHash: info?.content_hash ?? null,
        specHashMatches: info ? packageHash(pkg) === info.content_hash : false,
      },
      scorerVersion: attempt.scorer_version,
      currentScorerVersion: SCORER_VERSION,
      storedScoreRatio: storedRatio,
      rescoredScoreRatio: rescored.score_ratio,
      matches: itemsMatch && Math.abs(rescored.score_ratio - storedRatio) < 1e-9,
    };
  }

  async function evidence(activity: SectionActivityRow, pkg: ActivityPackage) {
    const students = await pool.query<{
      user_id: string;
      display_name: string;
      email: string;
      student_id: string | null;
    }>(
      `SELECT app_user.id AS user_id, app_user.display_name, app_user.email::text, membership.student_id
       FROM memberships AS membership
       JOIN users AS app_user ON app_user.id = membership.user_id
       WHERE membership.section_id = $1 AND 'student' = ANY(membership.roles)
       ORDER BY app_user.display_name, app_user.email`,
      [activity.section_id],
    );
    const attempts = await pool.query<AttemptRow>(
      "SELECT * FROM activity_attempts WHERE section_activity_id = $1 ORDER BY attempt_no",
      [activity.id],
    );
    return students.rows.map((s) => {
      const mine = attempts.rows.filter((a) => a.user_id === s.user_id);
      const finished = mine.filter((a) => a.status === "finished");
      const best = pickAttempt(finished, "best");
      return {
        userId: s.user_id,
        displayName: s.display_name,
        email: s.email,
        studentId: s.student_id,
        attempts: mine.length,
        inProgress: mine.some((a) => a.status === "in_progress"),
        first: finished[0] ? attemptSummary(finished[0]) : null,
        best: best ? attemptSummary(best) : null,
        last: finished.length ? attemptSummary(finished[finished.length - 1] as AttemptRow) : null,
        // { policy, scoreRatio, bandIndex, attemptId (null for mean), attemptCount } or null.
        evidence: evidenceOf(pkg, finished, activity.evidence_policy),
      };
    });
  }

  async function authorizeEvidence(request: FastifyRequest, reply: FastifyReply) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    const { activityId } = request.params as { activityId: string };
    if (!idSchema.safeParse(activityId).success) {
      await reply.code(400).send({ error: "INVALID_REQUEST" });
      return null;
    }
    const activity = await loadActivity(activityId);
    if (!activity) {
      await reply.code(404).send({ error: "ACTIVITY_NOT_FOUND" });
      return null;
    }
    if (!isManager(user, await rolesFor(user, activity.section_id))) {
      await reply.code(403).send({ error: "FORBIDDEN" });
      return null;
    }
    return activity;
  }

  app.get("/api/section-activities/:activityId/evidence", async (request, reply) => {
    const activity = await authorizeEvidence(request, reply);
    if (!activity) return;
    const pkg = await loadSpec(activity.package_id);
    return reply.send({ activity: publicActivity(activity), students: await evidence(activity, pkg) });
  });

  app.get("/api/section-activities/:activityId/evidence/export", async (request, reply) => {
    const activity = await authorizeEvidence(request, reply);
    if (!activity) return;
    const pkg = await loadSpec(activity.package_id);
    const lang = pkg.languages[0] ?? "en";
    const pct = (a: { scoreRatio: number | null } | null) =>
      a && a.scoreRatio !== null ? (a.scoreRatio * 100).toFixed(2) : "";
    const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : "");
    const header = [
      "Student Name",
      "Student Email",
      "Student ID",
      "Attempts",
      "First Finished At",
      "First Score %",
      "Best Score %",
      "Last Score %",
      `Evidence Score % (${activity.evidence_policy})`,
      "Evidence Attempts Counted",
      "Evidence Band",
    ];
    const rows = (await evidence(activity, pkg)).map((s) => [
      s.displayName,
      s.email,
      s.studentId ?? "",
      s.attempts,
      iso(s.first?.finishedAt),
      pct(s.first),
      pct(s.best),
      pct(s.last),
      pct(s.evidence),
      s.evidence ? s.evidence.attemptCount : "",
      s.evidence && s.evidence.bandIndex !== null ? (bandView(pkg, s.evidence.bandIndex, lang)?.title ?? "") : "",
    ]);
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${activity.slug}-evidence.csv"`)
      .send(toCsv([header, ...rows]));
  });

  // ---------------------------------------------------------------------------------------------
  // Teacher-triggered gradebook sync (Phase 2). The preview and the apply share one computation
  // and the same rules, but the apply recomputes at confirm time: a learner who finishes an attempt
  // between preview and confirm is written with the fresh value. Per learner:
  //   no_attempt  no finished attempt: the cell is left alone (never zeroed, never deleted)
  //   new         no score yet: written
  //   unchanged   the cell already holds the policy's points: nothing to write
  //   changed     the cell still holds exactly what this activity last synced: rewritten
  //   manual      any other value (typed by hand, edited after a sync, or written by another
  //               activity): kept unless the teacher lists the learner in overwriteUserIds
  // ---------------------------------------------------------------------------------------------

  type SyncStatus = "no_attempt" | "new" | "unchanged" | "changed" | "manual";

  async function syncPlan(activity: SectionActivityRow, db: DatabasePool | DatabaseClient = pool) {
    if (!activity.assignment_id) return null;
    const assignment = await db.query<{ id: string; name: string; max_points: string }>(
      "SELECT id, name, max_points FROM assignments WHERE id = $1",
      [activity.assignment_id],
    );
    const target = assignment.rows[0];
    if (!target) return null;
    const maxPoints = Number(target.max_points);
    const pkg = await loadSpec(activity.package_id);
    const students = await evidence(activity, pkg);
    const scores = await db.query<{
      user_id: string;
      points_earned: string;
      synced_from_activity_id: string | null;
      synced_points: string | null;
    }>(
      "SELECT user_id, points_earned, synced_from_activity_id, synced_points FROM scores WHERE assignment_id = $1",
      [target.id],
    );
    const byUser = new Map(scores.rows.map((row) => [row.user_id, row]));
    const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    const rows = students.map((s) => {
      const current = byUser.get(s.userId);
      const currentPoints = current ? Number(current.points_earned) : null;
      const newPoints = s.evidence ? pointsFor(s.evidence.scoreRatio, maxPoints) : null;
      let status: SyncStatus;
      if (newPoints === null) status = "no_attempt";
      else if (!current || currentPoints === null) status = "new";
      else if (same(currentPoints, newPoints)) status = "unchanged";
      else if (
        current.synced_from_activity_id === activity.id &&
        current.synced_points !== null &&
        same(currentPoints, Number(current.synced_points))
      ) status = "changed";
      else status = "manual";
      return {
        userId: s.userId,
        displayName: s.displayName,
        email: s.email,
        studentId: s.studentId,
        evidence: s.evidence,
        currentPoints,
        newPoints,
        status,
      };
    });
    return { assignment: { id: target.id, name: target.name, maxPoints }, policy: activity.evidence_policy, rows };
  }

  app.get("/api/section-activities/:activityId/gradebook-sync", async (request, reply) => {
    const activity = await authorizeEvidence(request, reply);
    if (!activity) return;
    const plan = await syncPlan(activity);
    if (!plan) return reply.code(409).send({ error: "NO_LINKED_ASSIGNMENT" });
    return reply.send(plan);
  });

  app.post("/api/section-activities/:activityId/gradebook-sync", async (request, reply) => {
    const activity = await authorizeEvidence(request, reply);
    if (!activity) return;
    const parsed = syncSchema.safeParse(request.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const overwrite = new Set(parsed.data.overwriteUserIds);
    const outcome = await withTransaction(pool, async (client) => {
      const plan = await syncPlan(activity, client);
      if (!plan) return null;
      const written: { userId: string; status: SyncStatus; points: number }[] = [];
      for (const row of plan.rows) {
        const write = row.status === "new" || row.status === "changed" || (row.status === "manual" && overwrite.has(row.userId));
        if (!write || row.newPoints === null) continue;
        await client.query(
          `INSERT INTO scores (assignment_id, user_id, points_earned, synced_from_activity_id, synced_points, synced_at)
           VALUES ($1, $2, $3, $4, $3, now())
           ON CONFLICT (assignment_id, user_id) DO UPDATE
           SET points_earned = EXCLUDED.points_earned, synced_from_activity_id = EXCLUDED.synced_from_activity_id,
               synced_points = EXCLUDED.synced_points, synced_at = now(), updated_at = now()`,
          [plan.assignment.id, row.userId, row.newPoints, activity.id],
        );
        written.push({ userId: row.userId, status: row.status, points: row.newPoints });
      }
      const counts = Object.fromEntries(
        (["new", "changed", "unchanged", "manual", "no_attempt"] as const).map((k) => [k, plan.rows.filter((r) => r.status === k).length]),
      );
      await client.query(
        `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
         VALUES ($1, 'activity.gradebook_synced', 'section_activity', $2, $3::jsonb)`,
        [
          user.id,
          activity.id,
          JSON.stringify({
            assignmentId: plan.assignment.id,
            policy: plan.policy,
            counts,
            written: written.length,
            overwrittenManual: written.filter((w) => w.status === "manual").map((w) => w.userId),
          }),
        ],
      );
      return { assignment: plan.assignment, policy: plan.policy, counts, written };
    });
    if (!outcome) return reply.code(409).send({ error: "NO_LINKED_ASSIGNMENT" });
    return reply.send(outcome);
  });
}
