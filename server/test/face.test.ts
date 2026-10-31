import assert from "node:assert/strict";
import test from "node:test";

import { FACE_EMBEDDING_DIM, cosineSimilarity } from "../src/face.js";

test("cosine similarity: identical, orthogonal, opposite, and a known off-diagonal value", () => {
  const a = Array.from({ length: FACE_EMBEDDING_DIM }, (_, i) => Math.sin(i * 0.7));
  const b = Array.from({ length: FACE_EMBEDDING_DIM }, (_, i) => Math.cos(i * 0.7));

  // Identical vectors: 1.0 regardless of magnitude.
  assert.equal(cosineSimilarity(a, a), 1);
  assert.equal(cosineSimilarity([3, 4], [6, 8]), 1);

  // Opposite: -1.0.
  assert.equal(cosineSimilarity(a, a.map((x) => -x)), -1);

  // Orthogonal: 0.0 (within float error).
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-12);

  // A known off-diagonal value: cos between (1,0) and (1,1) is sqrt(2)/2.
  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 1]) - Math.SQRT1_2) < 1e-12);

  // Scale invariance for a non-unit pair.
  assert.ok(Math.abs(cosineSimilarity(a, b) - cosineSimilarity(a.map((x) => x * 5), b)) < 1e-12);
});

test("cosine similarity: zero vector yields 0 and mismatched lengths throw", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.throws(() => cosineSimilarity([1, 2], [1, 2, 3]), /length mismatch/);
});
