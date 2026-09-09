import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { readCurrentUser } from "../current-user.js";
import type { DatabasePool } from "../db.js";
import { hashToken } from "../security.js";
import { clearSessionCookie } from "../session.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;

  app.get("/api/auth/me", async (request, reply) => {
    const user = await readCurrentUser(request, pool, config);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isPlatformAdmin: user.isPlatformAdmin,
      },
    });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[config.sessionCookieName];
    if (token) {
      await pool.query(
        "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
        [hashToken(token)],
      );
    }
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });
}
