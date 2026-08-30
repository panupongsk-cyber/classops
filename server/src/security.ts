import { createHash, randomBytes } from "node:crypto";

import argon2 from "argon2";

const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function generateOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashPassword(password: string) {
  return argon2.hash(password, passwordOptions);
}

export function verifyPassword(passwordHash: string, password: string) {
  return argon2.verify(passwordHash, password);
}
