import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { DatabasePool } from "../src/db.js";

function testConfig(nodeEnv: AppConfig["nodeEnv"]): AppConfig {
  return {
    nodeEnv,
    host: "127.0.0.1",
    port: 3000,
    databaseUrl: "postgresql://unused",
    appBaseUrl: "https://classops.example.test",
    trustedOrigins: ["https://classops.example.test"],
    trustProxy: false,
    sessionCookieName: "classops_session",
    sessionTtlDays: 14,
    emailVerificationTtlMinutes: 60,
    passwordResetTtlMinutes: 30,
    outboxEncryptionKey: Buffer.alloc(32, 9).toString("base64"),
    googleOAuth: null,
  };
}

function fakePool() {
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
    end: async () => undefined,
  } as unknown as DatabasePool;
}

test("production rejects unsafe requests without a trusted Origin", async () => {
  const app = await buildApp({ config: testConfig("production"), pool: fakePool() });
  try {
    const response = await app.inject({ method: "POST", url: "/api/auth/logout" });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: "UNTRUSTED_ORIGIN" });
  } finally {
    await app.close();
  }
});

test("rate-limit errors retain HTTP 429 instead of becoming HTTP 500", async () => {
  const app = await buildApp({ config: testConfig("test"), pool: fakePool() });
  try {
    app.get(
      "/test/rate-limit",
      { config: { rateLimit: { max: 1, timeWindow: "1 minute" } } },
      async () => ({ ok: true }),
    );
    const first = await app.inject({ method: "GET", url: "/test/rate-limit" });
    const second = await app.inject({ method: "GET", url: "/test/rate-limit" });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 429);
    assert.deepEqual(second.json(), { error: "RATE_LIMITED" });
  } finally {
    await app.close();
  }
});
