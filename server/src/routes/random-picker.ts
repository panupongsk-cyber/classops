import { randomInt } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { canManageSessions, getSectionRoles } from "../authz.js";
import type { AppConfig } from "../config.js";
import { requireCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";

interface SessionRow {
  id: string;
  section_id: string;
  opened_at: string | null;
  closed_at: string | null;
}

async function getSession(pool: DatabasePool, sessionId: string) {
  const result = await pool.query<SessionRow>(
    "SELECT id, section_id, opened_at, closed_at FROM class_sessions WHERE id = $1",
    [sessionId],
  );
  return result.rows[0] ?? null;
}

function isOpen(session: SessionRow) {
  return session.opened_at !== null && session.closed_at === null;
}

export async function registerRandomPickerRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  // Fairness with no explicit "reset the rotation" action or state: pick uniformly at random
  // among checked-in students whose pick count THIS Session equals the current minimum among all
  // checked-in students. Round 1 starts everyone at 0; once everyone's been picked once, the
  // minimum becomes 1 and a new round begins on its own. A student who checks in mid-Session
  // starts at 0 picks -- the same as everyone did at the start -- so they're immediately eligible
  // without waiting for anything to reset. See phase2b1-product-spec.md.
  app.post("/api/sessions/:sessionId/pick", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sessionId } = request.params as { sessionId: string };
    const session = await getSession(pool, sessionId);
    if (!session) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });

    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, session.section_id);
      if (!canManageSessions(roles)) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    if (!isOpen(session)) return reply.code(409).send({ error: "SESSION_NOT_OPEN" });

    const candidates = await pool.query<{ user_id: string; email: string; display_name: string }>(
      `WITH counts AS (
         SELECT checkin.user_id, count(pick.id) AS pick_count
         FROM session_checkins AS checkin
         LEFT JOIN session_picks AS pick
           ON pick.session_id = checkin.session_id AND pick.user_id = checkin.user_id
         WHERE checkin.session_id = $1
         GROUP BY checkin.user_id
       ),
       min_count AS (SELECT min(pick_count) AS value FROM counts)
       SELECT app_user.id AS user_id, app_user.email::text, app_user.display_name
       FROM counts
       JOIN users AS app_user ON app_user.id = counts.user_id
       WHERE counts.pick_count = (SELECT value FROM min_count)`,
      [sessionId],
    );
    if (!candidates.rowCount) return reply.code(400).send({ error: "NO_ELIGIBLE_STUDENTS" });

    const chosen = candidates.rows[randomInt(candidates.rowCount)];
    if (!chosen) return reply.code(400).send({ error: "NO_ELIGIBLE_STUDENTS" });
    await pool.query("INSERT INTO session_picks (session_id, user_id) VALUES ($1, $2)", [
      sessionId,
      chosen.user_id,
    ]);
    return reply.send({
      picked: { userId: chosen.user_id, email: chosen.email, displayName: chosen.display_name },
    });
  });

  app.get("/api/sessions/:sessionId/picks", async (request, reply) => {
    const user = await requireCurrentUser(request, reply, pool, config);
    if (!user) return;
    const { sessionId } = request.params as { sessionId: string };
    const session = await getSession(pool, sessionId);
    if (!session) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });

    if (!user.isPlatformAdmin) {
      const roles = await getSectionRoles(pool, user.id, session.section_id);
      if (!canManageSessions(roles)) return reply.code(403).send({ error: "FORBIDDEN" });
    }
    const result = await pool.query(
      `SELECT app_user.id AS user_id, app_user.email::text, app_user.display_name, pick.picked_at
       FROM session_picks AS pick
       JOIN users AS app_user ON app_user.id = pick.user_id
       WHERE pick.session_id = $1
       ORDER BY pick.picked_at DESC`,
      [sessionId],
    );
    return reply.send({ picks: result.rows });
  });
}
