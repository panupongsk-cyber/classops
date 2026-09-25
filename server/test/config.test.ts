import assert from "node:assert/strict";
import test from "node:test";

import { loadAppConfig } from "../src/config.js";

const requiredEnv = {
  DATABASE_URL: "postgresql://unused",
  APP_BASE_URL: "https://classops.example.test",
  TRUSTED_ORIGINS: "https://classops.example.test",
  SEALED_PAYLOAD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  ADMIN_GOOGLE_EMAIL: "admin@example.test",
};

function withEnv<T>(overrides: Record<string, string>, run: () => T): T {
  const previous = { ...process.env };
  Object.assign(process.env, requiredEnv, overrides);
  try {
    return run();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
}

test("empty-string Google OAuth env vars are treated as not configured, not a validation error", () => {
  // Docker Compose passes an unset `${VAR}` through as an empty string rather than omitting the
  // key — config.ts must tolerate that for optional fields (this crashed the API container in
  // compose.v2.prod.yml before the fix: Zod's `.optional()` alone only tolerates `undefined`).
  const config = withEnv(
    { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_REDIRECT_URI: "" },
    () => loadAppConfig(),
  );
  assert.equal(config.googleOAuth, null);
});

test("fully configured Google OAuth env vars populate googleOAuth", () => {
  const config = withEnv(
    {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REDIRECT_URI: "https://classops.example.test/api/auth/google/callback",
    },
    () => loadAppConfig(),
  );
  assert.deepEqual(config.googleOAuth, {
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://classops.example.test/api/auth/google/callback",
  });
});

test("partially configured Google OAuth env vars still throws", () => {
  assert.throws(() =>
    withEnv({ GOOGLE_CLIENT_ID: "client-id" }, () => loadAppConfig()),
  );
});

test("empty-string Microsoft OAuth env vars are treated as not configured, not a validation error", () => {
  const config = withEnv(
    { MICROSOFT_CLIENT_ID: "", MICROSOFT_CLIENT_SECRET: "", MICROSOFT_REDIRECT_URI: "" },
    () => loadAppConfig(),
  );
  assert.equal(config.microsoftOAuth, null);
});

test("fully configured Microsoft OAuth env vars populate microsoftOAuth", () => {
  const config = withEnv(
    {
      MICROSOFT_CLIENT_ID: "ms-client-id",
      MICROSOFT_CLIENT_SECRET: "ms-client-secret",
      MICROSOFT_REDIRECT_URI: "https://classops.example.test/api/auth/microsoft/callback",
    },
    () => loadAppConfig(),
  );
  assert.deepEqual(config.microsoftOAuth, {
    clientId: "ms-client-id",
    clientSecret: "ms-client-secret",
    redirectUri: "https://classops.example.test/api/auth/microsoft/callback",
  });
});

test("partially configured Microsoft OAuth env vars still throws", () => {
  assert.throws(() =>
    withEnv({ MICROSOFT_CLIENT_ID: "ms-client-id" }, () => loadAppConfig()),
  );
});

test("Google and Microsoft OAuth configuration are independent of each other", () => {
  const config = withEnv(
    {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REDIRECT_URI: "https://classops.example.test/api/auth/google/callback",
    },
    () => loadAppConfig(),
  );
  assert.notEqual(config.googleOAuth, null);
  assert.equal(config.microsoftOAuth, null);
});

test("TRUST_PROXY accepts false, true, or a list of IP addresses/CIDRs, and nothing else", () => {
  assert.equal(withEnv({}, () => loadAppConfig()).trustProxy, false);
  assert.equal(withEnv({ TRUST_PROXY: "false" }, () => loadAppConfig()).trustProxy, false);
  assert.equal(withEnv({ TRUST_PROXY: "true" }, () => loadAppConfig()).trustProxy, true);
  assert.deepEqual(withEnv({ TRUST_PROXY: "172.16.0.0/12" }, () => loadAppConfig()).trustProxy, ["172.16.0.0/12"]);
  assert.deepEqual(withEnv({ TRUST_PROXY: "127.0.0.1, ::1/128" }, () => loadAppConfig()).trustProxy, ["127.0.0.1", "::1/128"]);
  for (const bad of ["1", "yes", "172.16.0.0/33", "172.16.0.0/12/1", "10.0.0.0/8,"]) {
    assert.throws(() => withEnv({ TRUST_PROXY: bad }, () => loadAppConfig()), Error, bad);
  }
});
