import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createDatabasePool, type DatabasePool } from "../src/db.js";
import { generateOpaqueToken, hashToken } from "../src/security.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

async function createUserWithSession(pool: DatabasePool, email: string) {
  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, status, email_verified_at) VALUES ($1, $2, 'active', now()) RETURNING id`,
    [email, email],
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) throw new Error("test user insert did not return an id");
  const token = generateOpaqueToken();
  await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [
    userId,
    hashToken(token),
  ]);
  return { userId, cookie: `classops_session=${token}` };
}

// Every inject shares 127.0.0.1 -- exactly the classroom case (campus NAT, and the tunnel with
// TRUST_PROXY=false, #721).
test("App-wide rate limit is per verified session; unverified cookies share the IP bucket", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query("TRUNCATE sessions, auth_identities, users RESTART IDENTITY CASCADE");
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
    sealedPayloadEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
    adminGoogleEmail: "admin@example.com",
    googleOAuth: null,
    microsoftOAuth: null,
  };
  const app = await buildApp({ config, pool });
  try {
    const a = await createUserWithSession(pool, "a@example.com");
    const b = await createUserWithSession(pool, "b@example.com");
    const me = (cookie?: string) => app.inject({ method: "GET", url: "/api/auth/me", headers: cookie ? { cookie } : {} });

    for (let i = 0; i < 100; i += 1) assert.equal((await me(a.cookie)).statusCode, 200);
    assert.equal((await me(a.cookie)).statusCode, 429, "one learner is still limited");
    assert.equal((await me(b.cookie)).statusCode, 200, "a classmate on the same IP is not");

    // Random, unverifiable cookies cannot mint fresh buckets: they all land in the IP bucket.
    for (let i = 0; i < 100; i += 1) assert.equal((await me(`classops_session=${generateOpaqueToken()}`)).statusCode, 401);
    assert.equal((await me(`classops_session=${generateOpaqueToken()}`)).statusCode, 429);
    assert.equal((await me()).statusCode, 429, "the anonymous IP bucket is the same one");
    assert.equal((await me(b.cookie)).statusCode, 200, "signed-in users are unaffected by it");
  } finally {
    await app.close();
  }
});
