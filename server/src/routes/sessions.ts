import { randomBytes, randomInt } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { canManageSessions, getSectionRoles } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

// Rotation window for QR check-in codes (product spec: 15-30s, defended against screenshot
// sharing, not exact-precision timing). Lazy rotation means a code can live slightly longer than
// this if nothing polls it exactly on schedule -- accepted, documented timing slop.
const QR_ROTATION_SECONDS = 20;

// Fixed at build time per the product spec -- not fetched from an endpoint, so the frontend embeds
// the same literal list to render tappable decoys alongside the teacher's displayed emoji.
const EMOJI_PALETTE = [
  "🐶", "🐱", "🦊", "🐼", "🐵", "🐸", "🐧", "🦁",
  "🐷", "🐮", "🐨", "🦄", "🐙", "🦋", "🐝", "🐢",
];

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "must be HH:MM (24h)");

const patternSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
});
const termDatesSchema = z.object({
  termStartDate: z.iso.date(),
  termEndDate: z.iso.date(),
});
const generateSessionsSchema = z.object({
  rangeStart: z.iso.date().optional(),
  rangeEnd: z.iso.date().optional(),
});
const createSessionSchema = z
  .object({
    scheduledStart: z.iso.datetime({ offset: true }),
    scheduledEnd: z.iso.datetime({ offset: true }),
  })
  .refine((value) => new Date(value.scheduledStart) < new Date(value.scheduledEnd), {
    message: "scheduledStart must be before scheduledEnd",
    path: ["scheduledEnd"],
  });
const openSessionSchema = z.object({ checkInMethod: z.enum(["qr", "emoji"]) });
const checkInSchema = z.object({ value: z.string().trim().min(1).max(64) });

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

function generateCheckInCode() {
  return randomBytes(6).toString("base64url");
}

interface CourseTypeRow {
  type: "semester" | "self_paced" | "short_course";
}

async function getCourseTypeForSection(pool: DatabasePool, sectionId: string) {
  const result = await pool.query<CourseTypeRow>(
    `SELECT course.type
     FROM sections AS section
     JOIN courses AS course ON course.id = section.course_id
     WHERE section.id = $1`,
    [sectionId],
  );
  return result.rows[0]?.type ?? null;
}

interface SessionRow {
  id: string;
  section_id: string;
  scheduled_start: string;
  scheduled_end: string;
  check_in_method: "qr" | "emoji" | null;
  opened_at: string | null;
  closed_at: string | null;
  qr_code: string | null;
  qr_code_expires_at: string | null;
  active_emoji: string | null;
}

async function getSession(pool: DatabasePool, sessionId: string) {
  const result = await pool.query<SessionRow>(
    `SELECT id, section_id, scheduled_start, scheduled_end, check_in_method,
            opened_at, closed_at, qr_code, qr_code_expires_at, active_emoji
     FROM class_sessions WHERE id = $1`,
    [sessionId],
  );
  return result.rows[0] ?? null;
}

function isOpen(session: SessionRow) {
  return session.opened_at !== null && session.closed_at === null;
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  // Section-scoped configuration: term dates and weekly schedule patterns (semester Course.type
  // only). Both are operational config, not sensitive, so any Section member may read them; only
  // owner/teacher/ta may write.

  app.patch("/api/sections/:sectionId/term-dates", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    const parsed = termDatesSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageSessions(roles)) return reply.code(403).send({ error: "FORBIDDEN" });
    }

    try {
      const result = await pool.query(
        `UPDATE sections SET term_start_date = $2, term_end_date = $3, updated_at = now()
         WHERE id = $1 RETURNING term_start_date, term_end_date`,
        [sectionId, parsed.data.termStartDate, parsed.data.termEndDate],
      );
      if (!result.rowCount) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
      return reply.send({ section: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23514") {
        return reply.code(400).send({ error: "INVALID_TERM_DATE_RANGE" });
      }
      throw error;
    }
  });

  app.get("/api/sections/:sectionId/schedule-patterns", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (roles.length === 0) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const result = await pool.query(
      `SELECT id, day_of_week, start_time, end_time FROM session_schedule_patterns
       WHERE section_id = $1 ORDER BY day_of_week, start_time`,
      [sectionId],
    );
    return reply.send({ patterns: result.rows });
  });

  // `semester` Course.type only -- the recurring-schedule model has no meaning for a self-paced
  // or short course, which either has no Sessions at all or is scheduled one-off (see
  // phase2a-product-spec.md).
  app.post("/api/sections/:sectionId/schedule-patterns", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    const parsed = patternSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageSessions(roles)) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const courseType = await getCourseTypeForSection(pool, sectionId);
    if (courseType === null) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    if (courseType !== "semester") {
      return reply.code(400).send({ error: "SCHEDULE_PATTERNS_NOT_APPLICABLE" });
    }

    try {
      const result = await pool.query(
        `INSERT INTO session_schedule_patterns (section_id, day_of_week, start_time, end_time)
         VALUES ($1, $2, $3, $4) RETURNING id, day_of_week, start_time, end_time`,
        [sectionId, parsed.data.dayOfWeek, parsed.data.startTime, parsed.data.endTime],
      );
      return reply.code(201).send({ pattern: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23514") {
        return reply.code(400).send({ error: "INVALID_TIME_RANGE" });
      }
      throw error;
    }
  });

  // Reads term_start_date/term_end_date as the default range when not explicitly given. Inserting
  // a Session for a (section, scheduled_start) pair that already exists is a silent no-op
  // (ON CONFLICT DO NOTHING) so re-running this for an overlapping range never duplicates --
  // only newly-covered dates (a wider range, or a newly-added pattern) create rows.
  app.post("/api/sections/:sectionId/generate-sessions", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    const parsed = generateSessionsSchema.safeParse(request.body ?? {});
    if (!parsed.success) return validationError(reply, parsed.error);

    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageSessions(roles)) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const courseType = await getCourseTypeForSection(pool, sectionId);
    if (courseType === null) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    if (courseType !== "semester") {
      return reply.code(400).send({ error: "SESSION_GENERATION_NOT_APPLICABLE" });
    }

    const section = await pool.query<{ term_start_date: string | null; term_end_date: string | null }>(
      "SELECT term_start_date, term_end_date FROM sections WHERE id = $1",
      [sectionId],
    );
    const rangeStart = parsed.data.rangeStart ?? section.rows[0]?.term_start_date ?? null;
    const rangeEnd = parsed.data.rangeEnd ?? section.rows[0]?.term_end_date ?? null;
    if (!rangeStart || !rangeEnd) {
      return reply.code(400).send({ error: "TERM_DATE_RANGE_REQUIRED" });
    }

    const patterns = await pool.query(
      "SELECT 1 FROM session_schedule_patterns WHERE section_id = $1 LIMIT 1",
      [sectionId],
    );
    if (!patterns.rowCount) return reply.code(400).send({ error: "NO_SCHEDULE_PATTERNS" });

    const result = await pool.query(
      `WITH days AS (
         SELECT generate_series($2::date, $3::date, interval '1 day')::date AS d
       ),
       matches AS (
         SELECT
           $1::uuid AS section_id,
           (days.d + pattern.start_time) AS scheduled_start,
           (days.d + pattern.end_time) AS scheduled_end
         FROM days
         JOIN session_schedule_patterns AS pattern
           ON pattern.section_id = $1 AND extract(dow FROM days.d)::smallint = pattern.day_of_week
       )
       INSERT INTO class_sessions (section_id, scheduled_start, scheduled_end)
       SELECT section_id, scheduled_start, scheduled_end FROM matches
       ON CONFLICT (section_id, scheduled_start) DO NOTHING
       RETURNING id`,
      [sectionId, rangeStart, rangeEnd],
    );
    return reply.send({ createdCount: result.rowCount ?? 0 });
  });

  // Manual, one-at-a-time Session creation -- the only path for `short_course` Sections, and also
  // usable for `semester` Sections that need an ad hoc extra meeting outside the recurring
  // patterns. Not applicable to `self_paced` Sections, which never have Sessions.
  app.post("/api/sections/:sectionId/sessions", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);

    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageSessions(roles)) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const courseType = await getCourseTypeForSection(pool, sectionId);
    if (courseType === null) return reply.code(404).send({ error: "SECTION_NOT_FOUND" });
    if (courseType === "self_paced") {
      return reply.code(400).send({ error: "SESSION_NOT_APPLICABLE" });
    }

    try {
      const result = await pool.query(
        `INSERT INTO class_sessions (section_id, scheduled_start, scheduled_end)
         VALUES ($1, $2, $3)
         RETURNING id, section_id, scheduled_start, scheduled_end, check_in_method, opened_at, closed_at`,
        [sectionId, parsed.data.scheduledStart, parsed.data.scheduledEnd],
      );
      return reply.code(201).send({ session: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: "SESSION_ALREADY_EXISTS" });
      }
      throw error;
    }
  });

  app.get("/api/sections/:sectionId/sessions", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (!canManageSessions(roles)) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const result = await pool.query(
      `SELECT id, section_id, scheduled_start, scheduled_end, check_in_method, opened_at, closed_at
       FROM class_sessions WHERE section_id = $1 ORDER BY scheduled_start`,
      [sectionId],
    );
    return reply.send({ sessions: result.rows });
  });

  // Any Section member needs this to find what to check into -- unlike the other Session routes,
  // this one is intentionally not manager-only. Returns `null` (not 404) when nothing is open:
  // "no open Session right now" is a normal state for a polling client, not an error.
  app.get("/api/sections/:sectionId/sessions/open", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sectionId } = request.params as { sectionId: string };
    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, sectionId);
      if (roles.length === 0) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const result = await pool.query(
      `SELECT id, section_id, scheduled_start, scheduled_end, check_in_method, opened_at, closed_at
       FROM class_sessions
       WHERE section_id = $1 AND opened_at IS NOT NULL AND closed_at IS NULL
       ORDER BY opened_at DESC LIMIT 1`,
      [sectionId],
    );
    return reply.send({ session: result.rows[0] ?? null });
  });

  async function requireSessionManager(
    request: FastifyRequest,
    reply: FastifyReply,
    sessionId: string,
  ) {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return null;
    const session = await getSession(pool, sessionId);
    if (!session) {
      await reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      return null;
    }
    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, session.section_id);
      if (!canManageSessions(roles)) {
        await reply.code(403).send({ error: "FORBIDDEN" });
        return null;
      }
    }
    return session;
  }

  app.post("/api/sessions/:sessionId/open", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const parsed = openSessionSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const session = await requireSessionManager(request, reply, sessionId);
    if (!session) return;
    if (isOpen(session)) return reply.code(409).send({ error: "SESSION_ALREADY_OPEN" });

    const updated = await withTransaction(pool, async (client) => {
      if (parsed.data.checkInMethod === "qr") {
        const code = generateCheckInCode();
        return client.query(
          `UPDATE class_sessions
           SET opened_at = now(), closed_at = null, check_in_method = 'qr',
               qr_code = $2, qr_code_expires_at = now() + ($3 * interval '1 second'),
               active_emoji = null, updated_at = now()
           WHERE id = $1
           RETURNING id, check_in_method, opened_at, qr_code, qr_code_expires_at, active_emoji`,
          [sessionId, code, QR_ROTATION_SECONDS],
        );
      }
      const emoji = EMOJI_PALETTE[randomInt(EMOJI_PALETTE.length)];
      return client.query(
        `UPDATE class_sessions
         SET opened_at = now(), closed_at = null, check_in_method = 'emoji',
             active_emoji = $2, qr_code = null, qr_code_expires_at = null, updated_at = now()
         WHERE id = $1
         RETURNING id, check_in_method, opened_at, qr_code, qr_code_expires_at, active_emoji`,
        [sessionId, emoji],
      );
    });
    return reply.send({ session: updated.rows[0] });
  });

  app.post("/api/sessions/:sessionId/close", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = await requireSessionManager(request, reply, sessionId);
    if (!session) return;
    if (!isOpen(session)) return reply.code(409).send({ error: "SESSION_NOT_OPEN" });

    const result = await pool.query(
      `UPDATE class_sessions SET closed_at = now(), updated_at = now()
       WHERE id = $1 RETURNING id, check_in_method, opened_at, closed_at`,
      [sessionId],
    );
    return reply.send({ session: result.rows[0] });
  });

  // Teacher-facing display polls this roughly every QR_ROTATION_SECONDS. Lazy rotation: if the
  // stored code has expired by the time this request arrives, generate and persist a fresh one on
  // the spot rather than relying on any background job -- see phase2a-deployment-spec.md.
  app.get("/api/sessions/:sessionId/current-code", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = await requireSessionManager(request, reply, sessionId);
    if (!session) return;
    if (!isOpen(session) || session.check_in_method !== "qr") {
      return reply.code(400).send({ error: "QR_NOT_ACTIVE" });
    }

    const expired = !session.qr_code_expires_at || new Date(session.qr_code_expires_at) <= new Date();
    if (!expired) {
      return reply.send({ code: session.qr_code, expiresAt: session.qr_code_expires_at });
    }
    const code = generateCheckInCode();
    const result = await pool.query(
      `UPDATE class_sessions
       SET qr_code = $2, qr_code_expires_at = now() + ($3 * interval '1 second'), updated_at = now()
       WHERE id = $1 RETURNING qr_code, qr_code_expires_at`,
      [sessionId, code, QR_ROTATION_SECONDS],
    );
    const row = result.rows[0];
    return reply.send({ code: row?.qr_code, expiresAt: row?.qr_code_expires_at });
  });

  // Fixed for the whole open window -- unlike current-code, this never rotates on read.
  app.get("/api/sessions/:sessionId/current-emoji", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = await requireSessionManager(request, reply, sessionId);
    if (!session) return;
    if (!isOpen(session) || session.check_in_method !== "emoji") {
      return reply.code(400).send({ error: "EMOJI_NOT_ACTIVE" });
    }
    return reply.send({ emoji: session.active_emoji });
  });

  app.get("/api/sessions/:sessionId/roster", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = await requireSessionManager(request, reply, sessionId);
    if (!session) return;
    const result = await pool.query(
      `SELECT app_user.id AS user_id, app_user.email::text, app_user.display_name,
              membership.roles, checkin.checked_in_at
       FROM memberships AS membership
       JOIN users AS app_user ON app_user.id = membership.user_id
       LEFT JOIN session_checkins AS checkin
         ON checkin.session_id = $1 AND checkin.user_id = membership.user_id
       WHERE membership.section_id = $2
         AND membership.roles && ARRAY['student', 'ta']::text[]
       ORDER BY app_user.display_name`,
      [sessionId, session.section_id],
    );
    return reply.send({ roster: result.rows });
  });

  // The one endpoint a malicious/buggy client might hammer to guess a code or emoji -- a route-
  // level override tightens the global 100/min limit specifically here (phase2a-qa-spec.md §6).
  app.post(
    "/api/sessions/:sessionId/check-in",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const user = await requireCurrentUser(request, reply, pool, config);
      if (!user) return;
      const { sessionId } = request.params as { sessionId: string };
      const parsed = checkInSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error);

      const session = await getSession(pool, sessionId);
      if (!session) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });

      if (!user.isPlatformAdmin) {
        const roles = await getSectionRoles(pool, user.id, session.section_id);
        if (roles.length === 0) return reply.code(403).send({ error: "FORBIDDEN" });
      }
      if (!isOpen(session)) return reply.code(409).send({ error: "SESSION_NOT_OPEN" });

      // Identity checked in is always the authenticated caller -- never taken from the body.
      if (session.check_in_method === "qr") {
        const expired =
          !session.qr_code_expires_at || new Date(session.qr_code_expires_at) <= new Date();
        if (expired || parsed.data.value !== session.qr_code) {
          return reply.code(400).send({ error: "INVALID_CODE" });
        }
      } else if (session.check_in_method === "emoji") {
        if (parsed.data.value !== session.active_emoji) {
          return reply.code(400).send({ error: "INVALID_EMOJI" });
        }
      } else {
        return reply.code(409).send({ error: "SESSION_NOT_OPEN" });
      }

      const inserted = await pool.query<{ checked_in_at: string }>(
        `INSERT INTO session_checkins (session_id, user_id) VALUES ($1, $2)
         ON CONFLICT (session_id, user_id) DO NOTHING
         RETURNING checked_in_at`,
        [sessionId, user.id],
      );
      if (inserted.rowCount) {
        return reply.send({ checkedIn: true, checkedInAt: inserted.rows[0]?.checked_in_at });
      }
      const existing = await pool.query<{ checked_in_at: string }>(
        `SELECT checked_in_at FROM session_checkins WHERE session_id = $1 AND user_id = $2`,
        [sessionId, user.id],
      );
      return reply.send({ checkedIn: true, checkedInAt: existing.rows[0]?.checked_in_at });
    },
  );
}
