import { randomBytes, randomInt } from "node:crypto";

/**
 * Face check-in primitives shared by the enrollment and session routes. The 128-D embedding is a
 * browser-computed face descriptor (face-api.js); the server never sees an image, only the vector.
 */

export const FACE_EMBEDDING_DIM = 128;

// Calibration target, not a proven constant: configurable via FACE_MATCH_THRESHOLD at deploy time.
// Face-api.js 128-D descriptors typically clear ~0.6 for the same person at enrollment-like pose;
// see face-checkin-qa-spec.md §5 for the FAR/FRR trade-off.
export const FACE_MATCH_THRESHOLD_DEFAULT = 0.6;

export const FACE_CHALLENGE_TTL_SECONDS_DEFAULT = 60;

export const FACE_CHALLENGES = ["blink", "turn-left", "turn-right"] as const;
export type FaceChallenge = (typeof FACE_CHALLENGES)[number];

/** Cosine similarity of two same-length vectors, in [-1, 1]. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("vector length mismatch");
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

export function generateFaceNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function randomFaceChallenge(): FaceChallenge {
  return FACE_CHALLENGES[randomInt(FACE_CHALLENGES.length)] ?? "blink";
}
