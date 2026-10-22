import assert from "node:assert/strict";
import test from "node:test";

import { csvEscape, toCsv } from "../src/csv.js";
import { assignmentHeader, planGradebookImport, unescapeCell, type ImportMember } from "../src/gradebook-import.js";
import { parseCsvRecords } from "../src/roster-file.js";

const assignments = [
  { id: "hw1", name: "HW1", categoryName: "Homework", maxPoints: 10 },
  { id: "mid", name: "Midterm", categoryName: "Exams", maxPoints: 100 },
];
const categoryNames = ["Homework", "Exams"];
const members: ImportMember[] = [
  { userId: "u1", email: "one@example.com", displayName: "One", studentId: "65000001", rosterStudentId: "65000001", roles: ["student"] },
  { userId: "u2", email: "two@example.com", displayName: "Two", studentId: null, roles: ["student"] },
  { userId: "t1", email: "teacher@example.com", displayName: "Teacher", studentId: null, roles: ["owner"] },
  { userId: "ta", email: "ta@example.com", displayName: "TA", studentId: "65000009", roles: ["ta"] },
];
const header = ["Student Name", "Student Email", "Student ID", "HW1 (Homework)", "Midterm (Exams)", "Homework %", "Exams %", "Final Grade"];

function plan(rows: string[][], scores: [string, number][] = [], overrides: Partial<Parameters<typeof planGradebookImport>[0]> = {}) {
  const records = rows.map((cells, index) => ({ line: index + 1, cells }));
  return planGradebookImport({ records, assignments, categoryNames, members, scores: new Map(scores), ...overrides });
}

test("an unedited export round-trips with no changes, including two-decimal rounding", () => {
  const result = plan(
    [header, ["One", "one@example.com", "65000001", "8.13", "90.00", "81.25", "90.00", "86.50"], ["Two", "two@example.com", "", "3.00", "", "30.00", "", "30.00"]],
    [["hw1:u1", 8.125], ["mid:u1", 90], ["hw1:u2", 3]],
  );
  assert.equal(result.error, null);
  assert.deepEqual(result.unknownColumns, []);
  assert.deepEqual(result.matchedColumns.map((c) => c.assignmentId), ["hw1", "mid"]);
  assert.deepEqual(result.counts, { change: 0, unchanged: 2, rejected: 0, cells: 0, selfEnteredId: 0 });
});

test("a cell with more decimals than the export is taken literally", () => {
  const result = plan([header, ["One", "one@example.com", "65000001", "8.126", "", "", "", ""]], [["hw1:u1", 8.125]]);
  assert.deepEqual(result.rows[0]?.changes.map((c) => [c.from, c.to]), [[8.125, 8.126]]);
});

test("spreadsheet reformatting (8 for 8.00) is not a change; a new value is", () => {
  const result = plan(
    [header, ["One", "one@example.com", "65000001", "8", "95", "", "", ""]],
    [["hw1:u1", 8], ["mid:u1", 90]],
  );
  assert.equal(result.rows[0]?.status, "change");
  assert.deepEqual(result.rows[0]?.changes, [{ assignmentId: "mid", header: "Midterm (Exams)", from: 90, to: 95, overMax: false }]);
});

test("a blank cell leaves the stored score alone; a new score has from = null; extra credit is flagged", () => {
  const result = plan([header, ["Two", "two@example.com", "", "", "120", "", "", ""]], [["hw1:u2", 3]]);
  assert.deepEqual(result.rows[0]?.changes, [{ assignmentId: "mid", header: "Midterm (Exams)", from: null, to: 120, overMax: true }]);
});

test("student ID matches first, email is the fallback, and a mismatch never falls back", () => {
  const result = plan([
    header,
    ["x", "", "65000001", "1", "", "", "", ""], // by ID
    ["x", "TWO@example.com", "", "2", "", "", "", ""], // by email, case-insensitive
    ["x", "two@example.com", "65000001", "3", "", "", "", ""], // ID is One, email is Two
    ["x", "one@example.com", "99999999", "4", "", "", "", ""], // unknown ID despite a known email
    ["x", "nobody@example.com", "", "5", "", "", "", ""],
    ["x", "", "", "6", "", "", "", ""],
  ]);
  assert.deepEqual(
    result.rows.map((r) => [r.status, r.reason, r.userId]),
    [
      ["change", null, "u1"],
      ["change", null, "u2"],
      ["rejected", "ID_EMAIL_MISMATCH", null],
      ["rejected", "UNKNOWN_STUDENT_ID", null],
      ["rejected", "UNKNOWN_EMAIL", null],
      ["rejected", "NO_IDENTITY", null],
    ],
  );
});

test("staff are rejected, a TA is a gradebook row, and a repeated student is rejected after the first", () => {
  const result = plan([
    header,
    ["x", "teacher@example.com", "", "1", "", "", "", ""],
    ["x", "ta@example.com", "", "2", "", "", "", ""],
    ["x", "one@example.com", "", "3", "", "", "", ""],
    ["x", "", "65000001", "4", "", "", "", ""],
  ]);
  assert.deepEqual(result.rows.map((r) => r.reason), ["NOT_A_STUDENT", null, null, "DUPLICATE_STUDENT"]);
  assert.deepEqual(result.missing.map((m) => m.userId), ["u2"]);
});

test("a shared student ID is ambiguous, not resolved to one holder", () => {
  const twins: ImportMember[] = [
    { userId: "a", email: "a@example.com", displayName: "A", studentId: "650", roles: ["student"] },
    { userId: "b", email: "b@example.com", displayName: "B", studentId: "650", roles: ["student"] },
  ];
  const result = plan([header, ["x", "", "650", "1", "", "", "", ""]], [], { members: twins });
  assert.equal(result.rows[0]?.reason, "AMBIGUOUS_STUDENT_ID");
});

test("anything but a plain non-negative number rejects the whole row", () => {
  for (const bad of ["-1", "0x10", "1e3", "Infinity", "abc", "8,5", "1.2.3"]) {
    const result = plan([header, ["One", "one@example.com", "65000001", "9", bad, "", "", ""]]);
    assert.equal(result.rows[0]?.reason, "INVALID_SCORE", bad);
    assert.equal(result.rows[0]?.invalidHeader, "Midterm (Exams)");
    assert.equal(result.rows[0]?.changes.length, 0, "the valid HW1 cell is not written either");
  }
});

test("unknown columns are reported; computed and name columns are ignored silently", () => {
  const result = plan([[...header, "Quiz 3 (Homework)", "Notes"], ["One", "one@example.com", "65000001", "", "", "", "", "", "7", "x"]]);
  assert.deepEqual(result.unknownColumns, ["Quiz 3 (Homework)", "Notes"]);
  assert.equal(result.counts.cells, 0);
});

test("two Assignments with the same header, or a header given twice, write to neither", () => {
  const same = plan([header, ["One", "one@example.com", "65000001", "5", "", "", "", ""]], [], {
    assignments: [...assignments, { id: "hw1b", name: "HW1", categoryName: "Homework", maxPoints: 10 }],
  });
  assert.deepEqual(same.ambiguousColumns, ["HW1 (Homework)"]);
  assert.equal(same.counts.cells, 0);

  const twice = plan([["Student Email", "HW1 (Homework)", "HW1 (Homework)"], ["one@example.com", "5", "6"]]);
  assert.deepEqual(twice.ambiguousColumns, ["HW1 (Homework)"]);
  assert.equal(twice.counts.cells, 0);
});

test("headers survive the export's formula guard and a UTF-8 BOM", () => {
  const formulaName = "=SUM(A1)";
  const exported = csvEscape(assignmentHeader(formulaName, "Homework"));
  assert.ok(exported.startsWith("'"));
  assert.equal(unescapeCell("'=x"), "=x");
  assert.equal(unescapeCell("'plain"), "'plain");
  const result = plan(
    [["﻿Student Email", exported.replace(/^"|"$/g, "")], ["one@example.com", "4"]],
    [],
    { assignments: [{ id: "f", name: formulaName, categoryName: "Homework", maxPoints: 10 }] },
  );
  assert.deepEqual(result.matchedColumns, [{ header: "=SUM(A1) (Homework)", assignmentId: "f" }]);
  assert.equal(result.counts.cells, 1);
});

test("a file with neither an ID nor an email column is refused", () => {
  assert.equal(plan([["Student Name", "HW1 (Homework)"], ["One", "1"]]).error, "NO_IDENTITY_COLUMN");
  assert.equal(plan([]).error, "EMPTY_FILE");
});

test("reported lines are spreadsheet rows: blank records count, newlines inside quotes do not", () => {
  const text = ["", header.join(","), 'One,one@example.com,65000001,5,,,,', ",,,,,,,", '"Two\nline",two@example.com,,abc,,,,', "x,,99999999,1,,,,"].join("\r\n");
  const result = planGradebookImport({ records: parseCsvRecords(text), assignments, categoryNames, members, scores: new Map() });
  assert.deepEqual(result.rows.map((r) => [r.line, r.reason]), [[3, null], [5, "INVALID_SCORE"], [6, "UNKNOWN_STUDENT_ID"]]);
});

test("data under a blank header or past the header row is reported, padding is not", () => {
  const padded = plan([["Student Email", "HW1 (Homework)", ""], ["one@example.com", "5", ""]]);
  assert.deepEqual(padded.unknownColumns, []);
  const typed = plan([["Student Email", "HW1 (Homework)", ""], ["one@example.com", "", "9"], ["two@example.com", "", "", "4"]]);
  assert.deepEqual(typed.unknownColumns, ["(column 3)", "(column 4)"]);
});

test("every exported header matches its own Assignment, guard quote kept or dropped", () => {
  for (const name of ["'+1 bonus", "+1 bonus", "'=x", "=x", "-neg", "@at", "HW1"]) {
    const only = [{ id: "a", name, categoryName: "Homework", maxPoints: 10 }];
    const exported = parseCsvRecords(toCsv([["Student Email", assignmentHeader(name, "Homework")], ["one@example.com", "4"]]));
    const kept = planGradebookImport({ records: exported, assignments: only, categoryNames, members, scores: new Map() });
    assert.deepEqual(kept.matchedColumns.map((c) => c.assignmentId), ["a"], `${name} as exported`);
    const dropped = plan([["Student Email", assignmentHeader(name, "Homework")], ["one@example.com", "4"]], [], { assignments: only });
    assert.deepEqual(dropped.matchedColumns.map((c) => c.assignmentId), ["a"], `${name} without the guard`);
  }
});

test("a large exported score is still a score", () => {
  const result = plan([header, ["One", "one@example.com", "65000001", "", "12345678.00", "", "", ""]], [["mid:u1", 12345678]]);
  assert.equal(result.rows[0]?.status, "unchanged");
});

test("an ID with the student's roster email is the same student; another student's email is not", () => {
  const claimed: ImportMember[] = [
    { userId: "u1", email: "personal@example.net", rosterEmail: "one@example.com", displayName: "One", studentId: "65000001", roles: ["student"] },
    { userId: "u2", email: "two@example.com", displayName: "Two", studentId: null, roles: ["student"] },
  ];
  const result = plan(
    [header, ["x", "one@example.com", "65000001", "5", "", "", "", ""], ["x", "two@example.com", "65000001", "5", "", "", "", ""]],
    [],
    { members: claimed },
  );
  assert.deepEqual(result.rows.map((r) => r.reason), [null, "ID_EMAIL_MISMATCH"]);
});

test("an ID-only match on an ID the learner typed is imported but flagged; a roster ID or an email is not", () => {
  const typed: ImportMember[] = [
    { userId: "r", email: "r@example.com", displayName: "Roster", studentId: "650", rosterStudentId: "650", roles: ["student"] },
    { userId: "s", email: "s@example.com", displayName: "Self", studentId: "651", rosterStudentId: null, roles: ["student"] },
    { userId: "c", email: "c@example.com", displayName: "Changed", studentId: "653", rosterStudentId: "652", roles: ["student"] },
  ];
  const result = plan(
    [
      header,
      ["x", "", "650", "1", "", "", "", ""],
      ["x", "", "651", "1", "", "", "", ""],
      ["x", "", "653", "1", "", "", "", ""],
      ["x", "s@example.com", "651", "", "2", "", "", ""],
    ],
    [],
    { members: typed },
  );
  assert.deepEqual(result.rows.map((r) => [r.userId, r.status, r.selfEnteredId]), [
    ["r", "change", false],
    ["s", "change", true],
    ["c", "change", true],
    ["s", "rejected", false],
  ]);
  // The fourth row carries an email that confirms the ID, so it is not flagged (it repeats Self
  // and is rejected as a duplicate). The flag count covers changing rows only.
  assert.equal(result.counts.selfEnteredId, 2);
});
