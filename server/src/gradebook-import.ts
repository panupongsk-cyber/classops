// Gradebook CSV import (#2437): pure planning, no database, unit-tested directly.
//
// The accepted file is the gradebook export, possibly edited in a spreadsheet app. Decisions
// (Panupong, 2026-10-22):
// - A row finds its student by Student ID when that column exists and the cell is filled,
//   otherwise by Student Email. A filled ID that matches no one, or an ID and email that point at
//   different students, rejects the row -- it never falls back silently.
// - A header that matches no Assignment of this Section is reported and skipped; nothing is
//   created. Category "%" columns and "Final Grade" are computed values and are ignored.
// - A blank score cell leaves the stored score unchanged.
// - A row with an unusable score (not a plain non-negative number) is rejected whole; confirming
//   writes every valid row's changes.
//
// An unedited round trip must change nothing: the export writes scores with two decimals, so a
// cell equal to the stored score formatted the same way counts as unchanged.

export interface ImportAssignment {
  id: string;
  name: string;
  categoryName: string;
  maxPoints: number;
}

export interface ImportMember {
  userId: string;
  email: string;
  // The email the registrar's roster listed, when it differs from the account's (a claim by
  // student ID from a personal account). A row with this email and the matching ID is accepted.
  rosterEmail?: string | null;
  displayName: string;
  studentId: string | null;
  // The ID the registrar's roster gave (#2447). A student ID that differs from it, or that has
  // none, was typed by the learner.
  rosterStudentId?: string | null;
  roles: string[];
}

export interface ImportRecord {
  // 1-based record number in the file, blank records included: the spreadsheet row number.
  line: number;
  cells: string[];
}

export type RowStatus = "change" | "unchanged" | "rejected";

export type RejectReason =
  | "NO_IDENTITY"
  | "UNKNOWN_STUDENT_ID"
  | "AMBIGUOUS_STUDENT_ID"
  | "UNKNOWN_EMAIL"
  | "ID_EMAIL_MISMATCH"
  | "NOT_A_STUDENT"
  | "DUPLICATE_STUDENT"
  | "INVALID_SCORE";

export interface CellChange {
  assignmentId: string;
  header: string;
  from: number | null;
  to: number;
  overMax: boolean;
}

export interface PlannedImportRow {
  line: number;
  status: RowStatus;
  reason: RejectReason | null;
  // For INVALID_SCORE: the first offending column and its text.
  invalidHeader: string | null;
  invalidValue: string | null;
  studentId: string | null;
  email: string | null;
  userId: string | null;
  displayName: string | null;
  // Matched only by a student ID the learner typed, with no email in the row to confirm it
  // (#2447): still imported, but the preview asks the teacher to check the name.
  selfEnteredId: boolean;
  changes: CellChange[];
}

export interface ImportPlan {
  error: "EMPTY_FILE" | "NO_IDENTITY_COLUMN" | null;
  headers: string[];
  matchedColumns: { header: string; assignmentId: string }[];
  unknownColumns: string[];
  ambiguousColumns: string[];
  rows: PlannedImportRow[];
  // Gradebook students the file does not mention; their scores stay as they are.
  missing: { userId: string; displayName: string; studentId: string | null }[];
  counts: { change: number; unchanged: number; rejected: number; cells: number; selfEnteredId: number };
}

/** The export's column header for an Assignment. The export and the import both call this. */
export function assignmentHeader(name: string, categoryName: string) {
  return `${name} (${categoryName})`;
}

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** Undo csvEscape's formula guard: a leading quote is removed only before a formula trigger. */
export function unescapeCell(value: string) {
  return value.startsWith("'") && FORMULA_TRIGGER.test(value.slice(1)) ? value.slice(1) : value;
}

// A header as the file shows it after clean(), whether or not a spreadsheet app kept csvEscape's
// guard quote. unescapeCell alone is not csvEscape's inverse: "'+1 bonus" is exported unguarded
// and would lose its own quote, so expected headers go through the same guard-then-unescape.
function expectedHeader(text: string) {
  return unescapeCell((FORMULA_TRIGGER.test(text) ? `'${text}` : text).trim());
}

const clean = (value: string | undefined) => unescapeCell((value ?? "").replace(/^﻿/, "").trim());
const headerKey = (header: string) => clean(header).toLowerCase().replace(/[\s_.-]+/g, "");

const STUDENT_ID_HEADERS = new Set(["studentid", "studentcode", "studentno", "รหัสนักศึกษา", "รหัสนิสิต"]);
const EMAIL_HEADERS = new Set(["studentemail", "email", "อีเมล", "อีเมล์"]);
const NAME_HEADERS = new Set(["studentname", "name", "ชื่อ"]);

// Plain non-negative decimal, as the export writes it. Number() alone would accept "0x10",
// "1e3", "Infinity", and whitespace. Extra credit is allowed, so there is no upper bound beyond
// keeping the number sane.
const SCORE_PATTERN = /^\d{1,15}(\.\d{1,6})?$/;

/** The export's formatting of a stored score (two decimals). */
export function formatScore(value: number) {
  return value.toFixed(2);
}

// Equal values are unchanged. A cell with at most the export's two decimals also counts as
// unchanged when it is the stored score as the export rounded it (8.125 exported as "8.13").
// A cell with more decimals is taken literally, so 8.126 over a stored 8.125 is a change.
function sameScore(stored: number, cell: string, parsed: number) {
  if (stored === parsed) return true;
  const decimals = (cell.split(".")[1] ?? "").length;
  return decimals <= 2 && formatScore(stored) === formatScore(parsed);
}

export function planGradebookImport(input: {
  records: ImportRecord[];
  assignments: ImportAssignment[];
  categoryNames: string[];
  members: ImportMember[];
  // `${assignmentId}:${userId}` -> stored points
  scores: Map<string, number>;
}): ImportPlan {
  const empty = (error: ImportPlan["error"], headers: string[] = []): ImportPlan => ({
    error,
    headers,
    matchedColumns: [],
    unknownColumns: [],
    ambiguousColumns: [],
    rows: [],
    missing: [],
    counts: { change: 0, unchanged: 0, rejected: 0, cells: 0, selfEnteredId: 0 },
  });
  const [headerRecord, ...dataRecords] = input.records;
  if (!headerRecord) return empty("EMPTY_FILE");
  const headers = headerRecord.cells.map((h) => clean(h));

  // Expected header text -> Assignment ids. Two Assignments with the same text are ambiguous.
  const byHeader = new Map<string, string[]>();
  for (const assignment of input.assignments) {
    const text = expectedHeader(assignmentHeader(assignment.name, assignment.categoryName));
    byHeader.set(text, [...(byHeader.get(text) ?? []), assignment.id]);
  }
  const computedHeaders = new Set([...input.categoryNames.map((name) => expectedHeader(`${name} %`)), "Final Grade"]);
  // A column with no header is padding from a spreadsheet re-save unless some row has data in it
  // -- then it is reported like any other unknown column. The same goes for cells past the
  // header row's last column.
  const width = dataRecords.reduce((max, record) => Math.max(max, record.cells.length), headers.length);
  const hasData = (index: number) => dataRecords.some((record) => clean(record.cells[index]) !== "");

  let idColumn = -1;
  let emailColumn = -1;
  const scoreColumns: { index: number; header: string; assignmentId: string }[] = [];
  const unknownColumns: string[] = [];
  const ambiguousColumns: string[] = [];
  headers.forEach((header, index) => {
    const key = headerKey(header);
    if (idColumn < 0 && STUDENT_ID_HEADERS.has(key)) idColumn = index;
    else if (emailColumn < 0 && EMAIL_HEADERS.has(key)) emailColumn = index;
    else if (header === "") {
      if (hasData(index)) unknownColumns.push(`(column ${index + 1})`);
    } else if (NAME_HEADERS.has(key) || computedHeaders.has(header)) return;
    else {
      const ids = byHeader.get(header);
      if (!ids) unknownColumns.push(header);
      else if (ids.length > 1 || scoreColumns.some((column) => column.assignmentId === ids[0])) {
        if (!ambiguousColumns.includes(header)) ambiguousColumns.push(header);
      } else scoreColumns.push({ index, header, assignmentId: ids[0]! });
    }
  });
  for (let index = headers.length; index < width; index += 1) {
    if (hasData(index)) unknownColumns.push(`(column ${index + 1})`);
  }
  // A header repeated in the file is ambiguous for every copy, not just the later ones.
  for (let i = scoreColumns.length - 1; i >= 0; i -= 1) {
    if (ambiguousColumns.includes(scoreColumns[i]!.header)) scoreColumns.splice(i, 1);
  }
  if (idColumn < 0 && emailColumn < 0) return { ...empty("NO_IDENTITY_COLUMN", headers), unknownColumns };

  const maxPointsById = new Map(input.assignments.map((a) => [a.id, a.maxPoints]));
  const gradebookMembers = input.members.filter((m) => m.roles.includes("student") || m.roles.includes("ta"));
  // Student IDs are not unique across memberships, so a shared ID is ambiguous rather than
  // silently resolved to one of its holders.
  const membersById = new Map<string, ImportMember[]>();
  for (const member of input.members) {
    if (!member.studentId) continue;
    const id = member.studentId.toLowerCase();
    membersById.set(id, [...(membersById.get(id) ?? []), member]);
  }
  const memberByEmail = new Map(input.members.map((m) => [m.email.toLowerCase(), m]));
  const seen = new Set<string>();

  const rows = dataRecords.map(({ line, cells }): PlannedImportRow => {
    const studentId = idColumn >= 0 ? clean(cells[idColumn]) : "";
    const email = emailColumn >= 0 ? clean(cells[emailColumn]).toLowerCase() : "";
    const base: PlannedImportRow = {
      line,
      status: "rejected",
      reason: null,
      invalidHeader: null,
      invalidValue: null,
      studentId: studentId || null,
      email: email || null,
      userId: null,
      displayName: null,
      selfEnteredId: false,
      changes: [],
    };
    const reject = (reason: RejectReason, extra: Partial<PlannedImportRow> = {}) => ({ ...base, ...extra, reason });

    let member: ImportMember | undefined;
    if (studentId) {
      const holders = membersById.get(studentId.toLowerCase()) ?? [];
      if (holders.length === 0) return reject("UNKNOWN_STUDENT_ID");
      if (holders.length > 1) return reject("AMBIGUOUS_STUDENT_ID");
      member = holders[0]!;
      const known = [member.email, member.rosterEmail].filter(Boolean).map((e) => e!.toLowerCase());
      if (email && !known.includes(email)) return reject("ID_EMAIL_MISMATCH", { displayName: member.displayName });
    } else if (email) {
      member = memberByEmail.get(email);
      if (!member) return reject("UNKNOWN_EMAIL");
    } else return reject("NO_IDENTITY");

    const selfEnteredId =
      Boolean(studentId) && !email && member.rosterStudentId?.toLowerCase() !== studentId.toLowerCase();
    const who = { userId: member.userId, displayName: member.displayName, selfEnteredId };
    if (!(member.roles.includes("student") || member.roles.includes("ta"))) return reject("NOT_A_STUDENT", who);
    if (seen.has(member.userId)) return reject("DUPLICATE_STUDENT", who);
    seen.add(member.userId);

    const changes: CellChange[] = [];
    for (const column of scoreColumns) {
      const text = clean(cells[column.index]);
      if (text === "") continue;
      if (!SCORE_PATTERN.test(text)) return reject("INVALID_SCORE", { ...who, invalidHeader: column.header, invalidValue: text });
      const value = Number(text);
      const stored = input.scores.get(`${column.assignmentId}:${member.userId}`);
      if (stored !== undefined && sameScore(stored, text, value)) continue;
      changes.push({
        assignmentId: column.assignmentId,
        header: column.header,
        from: stored ?? null,
        to: value,
        overMax: value > (maxPointsById.get(column.assignmentId) ?? Infinity),
      });
    }
    return { ...base, ...who, status: changes.length ? "change" : "unchanged", changes };
  });

  const missing = gradebookMembers
    .filter((m) => !seen.has(m.userId))
    .map((m) => ({ userId: m.userId, displayName: m.displayName, studentId: m.studentId }));
  return {
    error: null,
    headers,
    matchedColumns: scoreColumns.map(({ header, assignmentId }) => ({ header, assignmentId })),
    unknownColumns,
    ambiguousColumns,
    rows,
    missing,
    counts: {
      change: rows.filter((r) => r.status === "change").length,
      unchanged: rows.filter((r) => r.status === "unchanged").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
      cells: rows.reduce((sum, r) => sum + r.changes.length, 0),
      selfEnteredId: rows.filter((r) => r.status === "change" && r.selfEnteredId).length,
    },
  };
}
