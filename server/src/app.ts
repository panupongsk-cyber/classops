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
      callback(Object.assign(new Error("Origin is not allowed"), { statusCode: 403 }), false);
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
    if ((!origin && config.nodeEnv === "production") || (origin && !trustedOriginSet.has(origin))) {
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
    if (reply.sent) return;
    const errorWithStatus = error as { statusCode?: unknown };
    const statusCode =
      typeof errorWithStatus.statusCode === "number" &&
      errorWithStatus.statusCode >= 400 &&
      errorWithStatus.statusCode < 500
        ? errorWithStatus.statusCode
        : 500;
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    else request.log.warn({ err: error }, "request rejected");
    const errorCode =
      statusCode === 429
        ? "RATE_LIMITED"
        : statusCode === 403
          ? "REQUEST_REJECTED"
          : statusCode === 415
            ? "UNSUPPORTED_MEDIA_TYPE"
            : statusCode < 500
              ? "INVALID_REQUEST"
              : "INTERNAL_SERVER_ERROR";
    void reply.code(statusCode).send({ error: errorCode });
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
