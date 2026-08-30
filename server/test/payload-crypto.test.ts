import assert from "node:assert/strict";
import test from "node:test";

import { decryptMailPayload, encryptMailPayload } from "../src/email/payload-crypto.js";

test("encrypts and authenticates outbox payloads", () => {
  const key = Buffer.alloc(32, 9).toString("base64");
  const payload = { actionUrl: "https://example.com/verify?token=secret", expiryMinutes: 60 };
  const encrypted = encryptMailPayload(payload, key);
  assert.doesNotMatch(encrypted, /secret/);
  assert.deepEqual(decryptMailPayload(encrypted, key), payload);
});

test("rejects outbox payload tampering", () => {
  const key = Buffer.alloc(32, 3).toString("base64");
  const encrypted = encryptMailPayload({ token: "sensitive" }, key);
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => decryptMailPayload(tampered, key));
});
