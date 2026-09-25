// Reading a Section roster file: the registrar's student-list CSV, or a simple template.
//
// The registrar exports TIS-620 / Windows-874 (Thai, ISO-8859-11), not UTF-8, with CRLF line
// endings and no BOM. Decoding is therefore explicit: strict UTF-8 when the bytes are valid UTF-8
// (with or without a BOM), otherwise TIS-620 with the Windows-874 extensions. The Thai block maps
// byte 0xA1..0xFB straight onto U+0E01..U+0E5B, so no codec library is needed.

export type RosterEncoding = "utf-8" | "tis-620";

const WINDOWS_874_EXTRAS: Record<number, string> = {
  0x80: "€",
  0x85: "…",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0xa0: " ",
};

/** TIS-620 / Windows-874 bytes to text. Bytes with no mapping become U+FFFD and are counted. */
export function decodeTis620(bytes: Uint8Array): { text: string; unmapped: number } {
  let text = "";
  let unmapped = 0;
  for (const b of bytes) {
    if (b < 0x80) text += String.fromCharCode(b);
    else if ((b >= 0xa1 && b <= 0xda) || (b >= 0xdf && b <= 0xfb)) text += String.fromCharCode(0x0e01 + (b - 0xa1));
    else if (WINDOWS_874_EXTRAS[b] !== undefined) text += WINDOWS_874_EXTRAS[b];
    else {
      text += "�";
      unmapped += 1;
    }
  }
  return { text, unmapped };
}

/** Decode a roster file. `auto` picks UTF-8 only when the bytes are strictly valid UTF-8. */
export function decodeRosterBytes(bytes: Uint8Array, encoding: RosterEncoding | "auto" = "auto") {
  const utf8 = () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  if (encoding === "utf-8") return { text: utf8(), encoding: "utf-8" as const, unmapped: 0 };
  if (encoding === "auto") {
    try {
      return { text: utf8(), encoding: "utf-8" as const, unmapped: 0 };
    } catch {
      // Not UTF-8: fall through to TIS-620.
    }
  }
  const { text, unmapped } = decodeTis620(bytes);
  return { text, encoding: "tis-620" as const, unmapped };
}

/** RFC 4180 CSV: quoted fields, "" escapes, CRLF or LF, a trailing newline. Blank lines dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface RosterFileRow {
  line: number;
  studentId: string;
  email: string;
  nameTh: string | null;
  nameEn: string | null;
  courseCode: string | null;
  section: string | null;
}

export type RosterFormat = "registrar" | "simple" | "custom";

/**
 * Which file column feeds which roster field, by exact (trimmed) header text. `nameTh` and `nameEn`
 * list name parts in order, e.g. prefix, given name, family name.
 */
export interface RosterMapping {
  studentId: string;
  email: string;
  nameTh: string[];
  nameEn: string[];
  section: string | null;
  courseCode: string | null;
}

const key = (header: string) => header.replace(/^\ufeff/, "").trim().toLowerCase().replace(/[\s_.-]+/g, "");

// Header names seen in student lists, in English and Thai (compared after key(): lowercased,
// without spaces, underscores, dots, or hyphens). Order is preference.
const SYNONYMS = {
  studentId: ["studentcode", "studentid", "studentno", "studentnumber", "รหัสนักศึกษา", "รหัสนิสิต", "รหัสประจำตัว", "รหัส", "id", "code"],
  email: ["studentemail", "email", "emailaddress", "mail", "อีเมล", "อีเมล์", "อีเมลนักศึกษา", "อีเมล์นักศึกษา"],
  prefixTh: ["prefixname", "prefix", "title", "คำนำหน้า", "คำนำหน้าชื่อ"],
  givenTh: ["studentname", "firstname", "givenname", "ชื่อ"],
  familyTh: ["studentsurname", "surname", "lastname", "familyname", "นามสกุล"],
  fullTh: ["name", "fullname", "ชื่อสกุล", "ชื่อนามสกุล", "ชื่อ-นามสกุล", "ชื่อ-สกุล"],
  prefixEn: ["prefixnameeng", "prefixeng", "prefixen", "titleen"],
  givenEn: ["studentnameeng", "firstnameeng", "firstnameen", "nameeng"],
  familyEn: ["studentsurnameeng", "surnameeng", "lastnameeng", "lastnameen"],
  fullEn: ["nameen", "englishname", "fullnameen", "ชื่อภาษาอังกฤษ"],
  section: ["section", "sec", "กลุ่มเรียน", "กลุ่ม", "ตอนเรียน", "เซค"],
  courseCode: ["coursecode", "course", "subjectcode", "รหัสวิชา"],
} as const;

const PREFIX_KEYS = new Set<string>([...SYNONYMS.prefixTh, ...SYNONYMS.prefixEn]);

/** Suggest a mapping from the header. Missing studentId/email come back as null. */
export function suggestMapping(header: string[]) {
  const byKey = new Map<string, string>();
  for (const h of header) {
    const k = key(h);
    if (k && !byKey.has(k)) byKey.set(k, h.replace(/^\ufeff/, "").trim());
  }
  const pick = (names: readonly string[]) => {
    for (const name of names) {
      const found = byKey.get(key(name));
      if (found) return found;
    }
    return null;
  };
  const parts = (...groups: (readonly string[])[]) => groups.map(pick).filter((h): h is string => h !== null);
  const split = parts(SYNONYMS.prefixTh, SYNONYMS.givenTh, SYNONYMS.familyTh);
  const nameTh = split.length >= 2 ? split : parts(SYNONYMS.fullTh).length ? parts(SYNONYMS.fullTh) : split;
  const splitEn = parts(SYNONYMS.prefixEn, SYNONYMS.givenEn, SYNONYMS.familyEn);
  const nameEn = splitEn.length >= 2 ? splitEn : parts(SYNONYMS.fullEn);
  return {
    studentId: pick(SYNONYMS.studentId),
    email: pick(SYNONYMS.email),
    nameTh,
    nameEn,
    section: pick(SYNONYMS.section),
    courseCode: pick(SYNONYMS.courseCode),
  };
}

function formatOf(mapping: RosterMapping): RosterFormat {
  if (key(mapping.studentId) === "studentcode" && key(mapping.email) === "studentemail") return "registrar";
  if (key(mapping.studentId) === "studentid" && key(mapping.email) === "email") return "simple";
  return "custom";
}

/**
 * Join name parts. A prefix column glues onto the next part when its value ends in Thai ("นาย" +
 * "สมชาย" = "นายสมชาย", the Thai convention); every other part is space-separated.
 */
function joinName(parts: { header: string; value: string }[]) {
  let out = "";
  for (let i = 0; i < parts.length; i += 1) {
    const { header, value } = parts[i]!;
    if (!value) continue;
    const previous = parts[i - 1];
    const glue = previous && previous.value && PREFIX_KEYS.has(key(previous.header)) && /[\u0E00-\u0E7F]$/.test(previous.value);
    out += out && !glue ? ` ${value}` : value;
  }
  return out === "" ? null : out;
}

export type RosterRead =
  | { format: RosterFormat; headers: string[]; mapping: RosterMapping; rows: RosterFileRow[] }
  | { error: "EMPTY_FILE" }
  | { error: "NEEDS_MAPPING" | "INVALID_MAPPING"; headers: string[]; suggestion: ReturnType<typeof suggestMapping> };

/**
 * Map a parsed CSV to roster rows. With no `mapping` the header decides: the registrar's list
 * (STUDENTCODE ... STUDENTEMAIL), the simple template (student_id, name, email), or any header the
 * synonyms cover. When student ID or email can't be placed, the caller must supply a mapping.
 */
export function readRoster(rows: string[][], mapping?: RosterMapping): RosterRead {
  const [rawHeader, ...body] = rows;
  if (!rawHeader) return { error: "EMPTY_FILE" };
  const headers = rawHeader.map((h) => h.replace(/^\ufeff/, "").trim());
  const suggestion = suggestMapping(headers);
  let chosen: RosterMapping;
  if (mapping) {
    const known = new Set(headers);
    const used = [mapping.studentId, mapping.email, ...mapping.nameTh, ...mapping.nameEn, mapping.section, mapping.courseCode].filter((h): h is string => h !== null);
    if (!mapping.studentId || !mapping.email || used.some((h) => !known.has(h))) return { error: "INVALID_MAPPING", headers, suggestion };
    chosen = mapping;
  } else {
    if (!suggestion.studentId || !suggestion.email) return { error: "NEEDS_MAPPING", headers, suggestion };
    chosen = { ...suggestion, studentId: suggestion.studentId, email: suggestion.email };
  }
  const column = new Map(headers.map((h, i) => [h, i]));
  const cell = (r: string[], header: string | null) => (header === null ? "" : (r[column.get(header) ?? -1] ?? "").trim());
  return {
    format: formatOf(chosen),
    headers,
    mapping: chosen,
    rows: body.map((r, i) => ({
      line: i + 2,
      studentId: cell(r, chosen.studentId),
      email: cell(r, chosen.email).toLowerCase(),
      nameTh: joinName(chosen.nameTh.map((header) => ({ header, value: cell(r, header) }))),
      nameEn: joinName(chosen.nameEn.map((header) => ({ header, value: cell(r, header) }))),
      courseCode: cell(r, chosen.courseCode) || null,
      section: cell(r, chosen.section) || null,
    })),
  };
}
