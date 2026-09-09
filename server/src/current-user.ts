import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthenticatedUser } from "./authz.js";
import type { AppConfig } from "./config.js";
import type { DatabasePool } from "./db.js";
import { hashToken } from "./security.js";

interface SessionUserRow {
  id: string;
  email: string;
  display_name: string;
  is_platform_admin: boolean;
}

export async function readCurrentUser(
  request: FastifyRequest,
  pool: DatabasePool,
  config: AppConfig,
): Promise<AuthenticatedUser | null> {
  const token = request.cookies[config.sessionCookieName];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const result = await pool.query<SessionUserRow>(
    `UPDATE sessions AS session
     SET last_seen_at = now()
     FROM users AS app_user
     WHERE session.token_hash = $1
       AND session.user_id = app_user.id
       AND session.revoked_at IS NULL
       AND session.expires_at > now()
       AND app_user.status = 'active'
     RETURNING app_user.id, app_user.email::text, app_user.display_name,
               app_user.is_platform_admin`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isPlatformAdmin: row.is_platform_admin,
  };
}

export async function requireCurrentUser(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: DatabasePool,
  config: AppConfig,
): Promise<AuthenticatedUser | null> {
  const user = await readCurrentUser(request, pool, config);
  if (!user) {
    await reply.code(401).send({ error: "UNAUTHENTICATED" });
    return null;
  }
  return user;
}
