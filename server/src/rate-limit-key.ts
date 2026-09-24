import type { FastifyRequest } from "fastify";

import type { AppConfig } from "./config.js";
import type { DatabasePool } from "./db.js";
import { hashToken } from "./security.js";

/**
 * Rate-limit bucket key: the signed-in user when the session cookie maps to a live session,
 * otherwise the client IP.
 *
 * A whole class shares one IP twice over -- the campus NAT, and the Cloudflare Tunnel with
 * `TRUST_PROXY=false` (#721) -- so an IP-only limiter throttles every learner together. Keying by
 * a *verified* session (not the raw cookie) means an unauthenticated client cannot mint fresh
 * buckets with random cookie values: those fall back to the IP bucket. A lookup failure also
 * falls back to the IP, so the limiter never turns a database blip into a 500.
 */
export function sessionRateLimitKey(pool: DatabasePool, config: AppConfig) {
  return async (request: FastifyRequest): Promise<string> => {
    const token = request.cookies?.[config.sessionCookieName];
    if (token) {
      try {
        const result = await pool.query<{ user_id: string }>(
          `SELECT user_id FROM sessions
           WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
          [hashToken(token)],
        );
        const userId = result.rows[0]?.user_id;
        if (userId) return `user:${userId}`;
      } catch {
        // Fall through to the IP bucket.
      }
    }
    return `ip:${request.ip}`;
  };
}
