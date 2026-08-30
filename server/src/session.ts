import type { FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "./config.js";
import type { DatabasePool } from "./db.js";
import { generateOpaqueToken, hashToken } from "./security.js";

export function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string) {
  reply.setCookie(config.sessionCookieName, token, {
    path: "/",
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    maxAge: config.sessionTtlDays * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig) {
  reply.clearCookie(config.sessionCookieName, {
    path: "/",
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
  });
}

export async function issueSession(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: DatabasePool,
  config: AppConfig,
  userId: string,
) {
  const sessionToken = generateOpaqueToken();
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, now() + ($3 * interval '1 day'), $4, $5)`,
    [
      userId,
      hashToken(sessionToken),
      config.sessionTtlDays,
      request.ip,
      request.headers["user-agent"]?.slice(0, 500) ?? null,
    ],
  );
  setSessionCookie(reply, config, sessionToken);
}
