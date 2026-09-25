import { isIP } from "node:net";

import type { FastifyRequest } from "fastify";

import type { AppConfig } from "./config.js";
import type { DatabasePool } from "./db.js";
import { hashToken } from "./security.js";

/**
 * Rate-limit bucket key: the signed-in user when the session cookie maps to a live session,
 * otherwise the client IP.
 *
 * A whole class can share one IP -- the campus NAT -- so an IP-only limiter would throttle every
 * learner together. (The tunnel no longer adds a second shared IP: since PS-TASK-20260925-727 the
 * gateway resolves the client address and TRUST_PROXY trusts only the gateway.) Keying by
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
    return `ip:${clientAddressBucket(request.ip)}`;
  };
}

/**
 * The anonymous bucket for a client address: IPv4 as is, IPv6 by its /64. A single IPv6
 * subscriber usually holds a whole /64, so keying by the full address would let one client mint
 * fresh buckets by rotating addresses. IPv4-mapped IPv6 (`::ffff:a.b.c.d`) counts as its IPv4.
 * Anything unparseable is kept verbatim.
 */
export function clientAddressBucket(address: string): string {
  const plain = address.split("%")[0] ?? address;
  if (isIP(plain) === 4) return plain;
  if (isIP(plain) !== 6) return address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(plain);
  if (mapped?.[1]) return mapped[1];
  const [head = "", tail] = plain.toLowerCase().split("::");
  const toGroups = (part: string) =>
    part === ""
      ? []
      : part.split(":").flatMap((group) => {
          if (!group.includes(".")) return [group];
          const [a = 0, b = 0, c = 0, d = 0] = group.split(".").map(Number);
          return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
        });
  const left = toGroups(head);
  const right = tail === undefined ? [] : toGroups(tail);
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return `${groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(":")}::/64`;
}
