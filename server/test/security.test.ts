import assert from "node:assert/strict";
import test from "node:test";

import { generateOpaqueToken, hashToken, normalizeEmail } from "../src/security.js";

test("normalizes email identifiers", () => {
  assert.equal(normalizeEmail("  Teacher@Example.COM "), "teacher@example.com");
});

test("opaque tokens are random and hash deterministically", () => {
  const first = generateOpaqueToken();
  const second = generateOpaqueToken();
  assert.notEqual(first, second);
  assert.ok(first.length >= 40);
  assert.equal(hashToken(first), hashToken(first));
  assert.notEqual(hashToken(first), hashToken(second));
});
