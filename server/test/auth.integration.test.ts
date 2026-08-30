import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createDatabasePool } from "../src/db.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  "email registration, verification, session, and password reset flow",
  { skip: !databaseUrl },
  async () => {
    if (!databaseUrl) return;
    const pool = createDatabasePool(databaseUrl);
    await pool.query(
      `TRUNCATE audit_log, email_outbox, password_reset_tokens, email_verification_tokens,
                sessions, auth_identities, users
       RESTART IDENTITY CASCADE`,
    );

    const config: AppConfig = {
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 3000,
      databaseUrl,
      appBaseUrl: "http://localhost:5173",
      trustedOrigins: ["http://localhost:5173"],
      trustProxy: false,
      sessionCookieName: "classops_session",
      sessionTtlDays: 14,
      emailVerificationTtlMinutes: 60,
      passwordResetTtlMinutes: 30,
      outboxEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
      googleOAuth: null,
    };
    const app = await buildApp({ config, pool });

    try {
      const registerResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        headers: { origin: "http://localhost:5173" },
        payload: {
          email: "student@example.com",
          password: "correct horse battery staple",
          displayName: "Test Student",
        },
      });
      assert.equal(registerResponse.statusCode, 202);

      const verificationMail = await pool.query<{ payload_encrypted: string }>(
        "SELECT payload_encrypted FROM email_outbox WHERE template = 'verify_email' ORDER BY id DESC LIMIT 1",
      );
      const { decryptMailPayload } = await import("../src/email/payload-crypto.js");
      const verificationPayload = decryptMailPayload(
        verificationMail.rows[0]?.payload_encrypted ?? "",
        config.outboxEncryptionKey,
      );
      const verificationUrl = new URL(String(verificationPayload.actionUrl ?? ""));
      const verificationToken = verificationUrl.searchParams.get("token");
      assert.ok(verificationToken);

      const verifyResponse = await app.inject({
        method: "POST",
        url: "/api/auth/verify-email",
        headers: { origin: "http://localhost:5173" },
        payload: { token: verificationToken },
      });
      assert.equal(verifyResponse.statusCode, 200);

      const loginResponse = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: "http://localhost:5173" },
        payload: { email: "student@example.com", password: "correct horse battery staple" },
      });
      assert.equal(loginResponse.statusCode, 200);
      const cookie = String(loginResponse.headers["set-cookie"]).split(";", 1)[0];
      assert.match(cookie, /^classops_session=/);

      const meResponse = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie },
      });
      assert.equal(meResponse.statusCode, 200);
      assert.equal(meResponse.json().user.email, "student@example.com");

      const forgotResponse = await app.inject({
        method: "POST",
        url: "/api/auth/forgot-password",
        headers: { origin: "http://localhost:5173" },
        payload: { email: "student@example.com" },
      });
      assert.equal(forgotResponse.statusCode, 202);

      const resetMail = await pool.query<{ payload_encrypted: string }>(
        "SELECT payload_encrypted FROM email_outbox WHERE template = 'reset_password' ORDER BY id DESC LIMIT 1",
      );
      const resetPayload = decryptMailPayload(
        resetMail.rows[0]?.payload_encrypted ?? "",
        config.outboxEncryptionKey,
      );
      const resetUrl = new URL(String(resetPayload.actionUrl ?? ""));
      const resetToken = resetUrl.searchParams.get("token");
      assert.ok(resetToken);

      const resetResponse = await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        headers: { origin: "http://localhost:5173" },
        payload: { token: resetToken, password: "new correct horse battery staple" },
      });
      assert.equal(resetResponse.statusCode, 200);

      const revokedSessionResponse = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie },
      });
      assert.equal(revokedSessionResponse.statusCode, 401);

      const reloginResponse = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: "http://localhost:5173" },
        payload: {
          email: "student@example.com",
          password: "new correct horse battery staple",
        },
      });
      assert.equal(reloginResponse.statusCode, 200);
    } finally {
      await app.close();
    }
  },
);
