import assert from "node:assert/strict";
import test from "node:test";

import { decryptPayload, encryptPayload } from "../src/sealed-payload.js";

test("encrypts and authenticates sealed payloads", () => {
  const key = Buffer.alloc(32, 9).toString("base64");
  const payload = { nonce: "abc", codeVerifier: "secret-verifier" };
  const encrypted = encryptPayload(payload, key);
  assert.doesNotMatch(encrypted, /secret-verifier/);
  assert.deepEqual(decryptPayload(encrypted, key), payload);
});

test("rejects sealed payload tampering", () => {
  const key = Buffer.alloc(32, 3).toString("base64");
  const encrypted = encryptPayload({ token: "sensitive" }, key);
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => decryptPayload(tampered, key));
});
