import assert from "node:assert/strict";
import test from "node:test";

import { scoreAttempt } from "../src/routes/practice.js";

// The ITPEC IP rule: pass needs 60% of all points and 30% in each of the three fields.
test("scoreAttempt applies the ITPEC IP pass rule per field and in total", () => {
  const qs = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, field: "Strategy", category: "A" })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, field: "Management", category: "B" })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, field: "Technology", category: "C" })),
  ];
  const ids = (list: string[]) => new Set(list);
  const all = ids(qs.map((q) => q.id));
  const pass = scoreAttempt(qs, ids(["s0", "s1", "s2", "s3", "m0", "t0"]), all, "itpec-ip");
  assert.deepEqual([pass.correct, pass.ratio, pass.pass], [6, 0.6, true], "60% total and every field at least 30%");
  const lowField = scoreAttempt(qs, ids(["s0", "s1", "s2", "s3", "m0", "m1", "m2"]), all, "itpec-ip");
  assert.deepEqual([lowField.ratio, lowField.pass, lowField.fields.find((f) => f.field === "Technology")!.pass], [0.7, false, false], "70% total fails with 0% in Technology");
  const unanswered = scoreAttempt(qs, ids([]), ids([]), "itpec-ip");
  assert.deepEqual([unanswered.correct, unanswered.pass, unanswered.fields.map((f) => f.answered)], [0, false, [0, 0, 0]]);
  assert.equal(scoreAttempt(qs, all, all, "other-family").pass, null);
  const ordered = scoreAttempt([...qs].reverse(), all, all, "itpec-ip", ["Strategy", "Management", "Technology"]);
  assert.deepEqual(ordered.fields.map((f) => f.field), ["Strategy", "Management", "Technology"], "the session's field order");
});

test("passFromFieldTotals mirrors the per-field rule", async () => {
  const { passFromFieldTotals } = await import("../src/routes/practice.js");
  assert.equal(passFromFieldTotals([{ correct: 18, questions: 20 }, { correct: 3, questions: 10 }], "itpec-ip"), true, "70% total, fields 90% and 30%");
  assert.equal(passFromFieldTotals([{ correct: 20, questions: 20 }, { correct: 2, questions: 10 }], "itpec-ip"), false);
  assert.equal(passFromFieldTotals([{ correct: 1, questions: 1 }], "other"), null);
});
