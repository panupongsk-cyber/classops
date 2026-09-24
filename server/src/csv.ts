// Shared CSV encoding for every staff export (gradebook, learning-activity evidence).
//
// Cells come from user-controlled text (display names, course/assignment names), and staff open
// these files in spreadsheet apps, so a cell that starts with a formula trigger is prefixed with
// a single quote (OWASP "CSV injection") and any cell containing a quote, comma, CR, or LF is
// quoted.

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvEscape(value: string) {
  const safe = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function toCsv(rows: readonly (readonly unknown[])[]) {
  return rows.map((row) => row.map((cell) => csvEscape(cell === null || cell === undefined ? "" : String(cell))).join(",")).join("\n");
}
