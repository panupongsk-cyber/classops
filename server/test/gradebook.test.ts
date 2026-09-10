import assert from "node:assert/strict";
import test from "node:test";

import { computeGrades } from "../src/gradebook.js";

test("one category, one assignment, one score: categoryPercent and finalGrade are the simple ratio", () => {
  const [grade] = computeGrades(
    [{ id: "c1", weight: 20 }],
    [{ id: "a1", categoryId: "c1", maxPoints: 50 }],
    [{ assignmentId: "a1", userId: "u1", pointsEarned: 45 }],
    ["u1"],
  );
  assert.equal(grade?.categoryPercentages.get("c1"), 90);
  assert.equal(grade?.finalGrade, 90);
});

test("within a category, multiple assignments combine points-weighted, not averaged", () => {
  // 45/50 and 8/10 averaged would be 85%; points-weighted is 53/60 = 88.33...%.
  const [grade] = computeGrades(
    [{ id: "c1", weight: 100 }],
    [
      { id: "a1", categoryId: "c1", maxPoints: 50 },
      { id: "a2", categoryId: "c1", maxPoints: 10 },
    ],
    [
      { assignmentId: "a1", userId: "u1", pointsEarned: 45 },
      { assignmentId: "a2", userId: "u1", pointsEarned: 8 },
    ],
    ["u1"],
  );
  const expected = (53 / 60) * 100;
  assert.ok(grade);
  assert.notEqual(Math.round((grade.categoryPercentages.get("c1") ?? 0) * 100) / 100, 85);
  assert.ok(Math.abs((grade.categoryPercentages.get("c1") ?? 0) - expected) < 1e-9);
});

test("an unscored assignment contributes to neither sum -- excluded, not zero", () => {
  const [grade] = computeGrades(
    [{ id: "c1", weight: 100 }],
    [
      { id: "a1", categoryId: "c1", maxPoints: 50 },
      { id: "a2", categoryId: "c1", maxPoints: 10 },
    ],
    [{ assignmentId: "a1", userId: "u1", pointsEarned: 45 }],
    ["u1"],
  );
  // If a2 (unscored) counted as 0/10, the result would be 45/60 = 75%. Excluded, it's 45/50 = 90%.
  assert.equal(grade?.categoryPercentages.get("c1"), 90);
});

test("weights need not sum to 100 -- active categories renormalize proportionally", () => {
  const [grade] = computeGrades(
    [
      { id: "c1", weight: 20 },
      { id: "c2", weight: 30 },
    ],
    [
      { id: "a1", categoryId: "c1", maxPoints: 100 },
      { id: "a2", categoryId: "c2", maxPoints: 100 },
    ],
    [
      { assignmentId: "a1", userId: "u1", pointsEarned: 100 }, // c1 = 100%
      { assignmentId: "a2", userId: "u1", pointsEarned: 0 }, // c2 = 0%
    ],
    ["u1"],
  );
  // 20/(20+30) = 40% weight on c1 (100%), 60% weight on c2 (0%) -> finalGrade = 40.
  assert.equal(grade?.finalGrade, 40);
});

test("a category with zero scored assignments is excluded entirely from the active set", () => {
  const [grade] = computeGrades(
    [
      { id: "c1", weight: 20 },
      { id: "c2", weight: 30 },
    ],
    [
      { id: "a1", categoryId: "c1", maxPoints: 100 },
      { id: "a2", categoryId: "c2", maxPoints: 100 },
    ],
    [{ assignmentId: "a1", userId: "u1", pointsEarned: 80 }],
    ["u1"],
  );
  assert.equal(grade?.categoryPercentages.has("c2"), false);
  // Only c1 is active -> finalGrade equals c1's own percentage regardless of its weight value.
  assert.equal(grade?.finalGrade, 80);
});

test("a student with no scored assignments anywhere has finalGrade null, not 0", () => {
  const [grade] = computeGrades(
    [{ id: "c1", weight: 100 }],
    [{ id: "a1", categoryId: "c1", maxPoints: 100 }],
    [],
    ["u1"],
  );
  assert.equal(grade?.finalGrade, null);
  assert.equal(grade?.categoryPercentages.size, 0);
});

test("extra credit is allowed -- pointsEarned exceeding maxPoints is not clamped", () => {
  const [grade] = computeGrades(
    [{ id: "c1", weight: 100 }],
    [{ id: "a1", categoryId: "c1", maxPoints: 10 }],
    [{ assignmentId: "a1", userId: "u1", pointsEarned: 12 }],
    ["u1"],
  );
  assert.equal(grade?.categoryPercentages.get("c1"), 120);
  assert.equal(grade?.finalGrade, 120);
});

test("computes independently for multiple students in one call", () => {
  const grades = computeGrades(
    [{ id: "c1", weight: 100 }],
    [{ id: "a1", categoryId: "c1", maxPoints: 10 }],
    [
      { assignmentId: "a1", userId: "u1", pointsEarned: 10 },
      { assignmentId: "a1", userId: "u2", pointsEarned: 5 },
    ],
    ["u1", "u2", "u3"],
  );
  assert.equal(grades.find((g) => g.userId === "u1")?.finalGrade, 100);
  assert.equal(grades.find((g) => g.userId === "u2")?.finalGrade, 50);
  assert.equal(grades.find((g) => g.userId === "u3")?.finalGrade, null);
});
