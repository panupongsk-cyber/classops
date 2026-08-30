import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { enqueueMail } from "../email/outbox.js";
import {
  generateOpaqueToken,
  hashPassword,
  hashToken,
  normalizeEmail,
  verifyPassword,
} from "../security.js";
import { clearSessionCookie, issueSession } from "../session.js";

const emailSchema = z.email().max(320).transform(normalizeEmail);
const passwordSchema = z.string().min(12).max(128);
const displayNameSchema = z.string().trim().min(1).max(100);
const tokenSchema = z.string().min(40).max(200);

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
const emailOnlySchema = z.object({ email: emailSchema });
const tokenOnlySchema = z.object({ token: tokenSchema });
const resetPasswordSchema = z.object({ token: tokenSchema, password: passwordSchema });

interface UserWithPasswordRow {
  id: string;
  email: string;
  display_name: string;
  status: "pending_verification" | "active" | "suspended";
  email_verified_at: Date | null;
  password_hash: string;
}

interface SessionUserRow {
  id: string;
  email: string;
  display_name: string;
  status: string;
  email_verified_at: Date | null;
}

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "INVALID_REQUEST",
    fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

async function readSessionUser(
  request: FastifyRequest,
  pool: DatabasePool,
  config: AppConfig,
) {
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
               app_user.status, app_user.email_verified_at`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: { pool: DatabasePool; config: AppConfig },
) {
  const { pool, config } = dependencies;
  const dummyPasswordHash = await hashPassword("classops-dummy-password-value");

  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error);

      const passwordHash = await hashPassword(parsed.data.password);
      const token = generateOpaqueToken();
      const tokenHash = hashToken(token);

      try {
        await withTransaction(pool, async (client) => {
          const existing = await client.query<{ id: string }>(
            "SELECT id FROM users WHERE email = $1",
            [parsed.data.email],
          );
          if (existing.rowCount) return;

          const inserted = await client.query<{ id: string }>(
            `INSERT INTO users (email, display_name)
             VALUES ($1, $2)
             RETURNING id`,
            [parsed.data.email, parsed.data.displayName],
          );
          const userId = inserted.rows[0]?.id;
          if (!userId) throw new Error("User insert did not return an id");

          await client.query(
            `INSERT INTO auth_identities (user_id, provider, provider_subject, password_hash)
             VALUES ($1, 'password', $2, $3)`,
            [userId, parsed.data.email, passwordHash],
          );
          await client.query(
            `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, now() + ($3 * interval '1 minute'))`,
            [userId, tokenHash, config.emailVerificationTtlMinutes],
          );
          await enqueueMail(client, {
            recipientEmail: parsed.data.email,
            template: "verify_email",
            payload: {
              actionUrl: `${config.appBaseUrl}/verify-email?token=${encodeURIComponent(token)}`,
              expiryMinutes: config.emailVerificationTtlMinutes,
            },
            encryptionKey: config.outboxEncryptionKey,
          });
          await client.query(
            `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id)
             VALUES ($1::uuid, 'auth.registered', 'user', $1::uuid::text)`,
            [userId],
          );
        });
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
      }

      return reply.code(202).send({
        message: "If the address can be registered, a verification email will be sent.",
      });
    },
  );

  app.post(
    "/api/auth/resend-verification",
    { config: { rateLimit: { max: 5, timeWindow: "1 day" } } },
    async (request, reply) => {
      const parsed = emailOnlySchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error);
      const token = generateOpaqueToken();
      const tokenHash = hashToken(token);

      await withTransaction(pool, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT id FROM users
           WHERE email = $1 AND status = 'pending_verification'
           FOR UPDATE`,
          [parsed.data.email],
        );
        const userId = result.rows[0]?.id;
        if (!userId) return;
        await client.query(
          `UPDATE email_verification_tokens SET used_at = now()
           WHERE user_id = $1 AND used_at IS NULL`,
          [userId],
        );
        await client.query(
          `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + ($3 * interval '1 minute'))`,
          [userId, tokenHash, config.emailVerificationTtlMinutes],
        );
        await enqueueMail(client, {
          recipientEmail: parsed.data.email,
          template: "verify_email",
          payload: {
            actionUrl: `${config.appBaseUrl}/verify-email?token=${encodeURIComponent(token)}`,
            expiryMinutes: config.emailVerificationTtlMinutes,
          },
          encryptionKey: config.outboxEncryptionKey,
        });
      });

      return reply.code(202).send({ message: "If the account exists, an email will be sent." });
    },
  );

  app.post("/api/auth/verify-email", async (request, reply) => {
    const parsed = tokenOnlySchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const tokenHash = hashToken(parsed.data.token);

    const verified = await withTransaction(pool, async (client) => {
      const result = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id
         FROM email_verification_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [tokenHash],
      );
      const record = result.rows[0];
      if (!record) return false;
      await client.query("UPDATE email_verification_tokens SET used_at = now() WHERE id = $1", [
        record.id,
      ]);
      await client.query(
        `UPDATE users
         SET email_verified_at = COALESCE(email_verified_at, now()), status = 'active', updated_at = now()
         WHERE id = $1`,
        [record.user_id],
      );
      await client.query(
        `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id)
         VALUES ($1::uuid, 'auth.email_verified', 'user', $1::uuid::text)`,
        [record.user_id],
      );
      return true;
    });

    if (!verified) return reply.code(400).send({ error: "INVALID_OR_EXPIRED_TOKEN" });
    return reply.send({ verified: true });
  });

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error);
      const result = await pool.query<UserWithPasswordRow>(
        `SELECT app_user.id, app_user.email::text, app_user.display_name,
                app_user.status, app_user.email_verified_at, identity.password_hash
         FROM users AS app_user
         JOIN auth_identities AS identity ON identity.user_id = app_user.id
         WHERE app_user.email = $1 AND identity.provider = 'password'`,
        [parsed.data.email],
      );
      const user = result.rows[0];
      const passwordMatches = await verifyPassword(
        user?.password_hash ?? dummyPasswordHash,
        parsed.data.password,
      );
      if (!user || !passwordMatches || user.status === "suspended") {
        return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      }
      if (!user.email_verified_at || user.status === "pending_verification") {
        return reply.code(403).send({ error: "EMAIL_NOT_VERIFIED" });
      }

      await issueSession(request, reply, pool, config, user.id);
      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          emailVerified: true,
        },
      });
    },
  );

  app.get("/api/auth/me", async (request, reply) => {
    const user = await readSessionUser(request, pool, config);
    if (!user) return reply.code(401).send({ error: "UNAUTHENTICATED" });
    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        emailVerified: Boolean(user.email_verified_at),
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

  app.post(
    "/api/auth/forgot-password",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = emailOnlySchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error);
      const token = generateOpaqueToken();
      const tokenHash = hashToken(token);

      await withTransaction(pool, async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT app_user.id
           FROM users AS app_user
           JOIN auth_identities AS identity ON identity.user_id = app_user.id
           WHERE app_user.email = $1 AND app_user.status = 'active' AND identity.provider = 'password'
           FOR UPDATE OF app_user`,
          [parsed.data.email],
        );
        const userId = result.rows[0]?.id;
        if (!userId) return;
        await client.query(
          "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
          [userId],
        );
        await client.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + ($3 * interval '1 minute'))`,
          [userId, tokenHash, config.passwordResetTtlMinutes],
        );
        await enqueueMail(client, {
          recipientEmail: parsed.data.email,
          template: "reset_password",
          payload: {
            actionUrl: `${config.appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`,
            expiryMinutes: config.passwordResetTtlMinutes,
          },
          encryptionKey: config.outboxEncryptionKey,
        });
      });
      return reply.code(202).send({ message: "If the account exists, an email will be sent." });
    },
  );

  app.post("/api/auth/reset-password", async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const passwordHash = await hashPassword(parsed.data.password);
    const tokenHash = hashToken(parsed.data.token);

    const reset = await withTransaction(pool, async (client) => {
      const result = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id
         FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [tokenHash],
      );
      const record = result.rows[0];
      if (!record) return false;
      await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [record.id]);
      await client.query(
        `UPDATE auth_identities
         SET password_hash = $2, updated_at = now()
         WHERE user_id = $1 AND provider = 'password'`,
        [record.user_id, passwordHash],
      );
      await client.query(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        [record.user_id],
      );
      await client.query(
        `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id)
         VALUES ($1::uuid, 'auth.password_reset', 'user', $1::uuid::text)`,
        [record.user_id],
      );
      return true;
    });

    if (!reset) return reply.code(400).send({ error: "INVALID_OR_EXPIRED_TOKEN" });
    clearSessionCookie(reply, config);
    return reply.send({ reset: true });
  });
}
