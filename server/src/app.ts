import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";

import type { AppConfig } from "./config.js";
import type { DatabasePool } from "./db.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerGoogleOAuthRoutes } from "./routes/google-oauth.js";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function buildApp(dependencies: { config: AppConfig; pool: DatabasePool }) {
  const { config, pool } = dependencies;
  const trustedOriginSet = new Set(config.trustedOrigins);
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers.set-cookie",
        "body.password",
        "body.token",
      ],
    },
    trustProxy: config.trustProxy,
  });

  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin || trustedOriginSet.has(origin)) return callback(null, true);
      callback(new Error("Origin is not allowed"), false);
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!unsafeMethods.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !trustedOriginSet.has(origin)) {
      await reply.code(403).send({ error: "UNTRUSTED_ORIGIN" });
    }
  });

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  await registerAuthRoutes(app, { pool, config });
  await registerGoogleOAuthRoutes(app, { pool, config });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    if (reply.sent) return;
    void reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
