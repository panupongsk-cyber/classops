import assert from "node:assert/strict";
import test from "node:test";

import { decodeRosterBytes, decodeTis620, parseCsv, readRoster, suggestMapping } from "../src/roster-file.js";
import { registrarCsv, STUDENTS, tis620 } from "./fixtures/synthetic-roster.js";

test("TIS-620: the Thai block maps onto U+0E01..U+0E5B, Windows-874 extras map, the rest is counted", () => {
  assert.deepEqual(decodeTis620(Buffer.from([0xa1, 0xd9, 0xdf, 0xfb, 0x41])), { text: "กู฿๛" + "A", unmapped: 0 });
  assert.deepEqual(decodeTis620(Buffer.from([0x96, 0xa0])), { text: "– ", unmapped: 0 });
  assert.deepEqual(decodeTis620(Buffer.from([0xdb, 0xff])), { text: "��", unmapped: 2 });
  assert.equal(decodeTis620(tis620("นายสมชาย ทดสอบศรี")).text, "นายสมชาย ทดสอบศรี");
});

test("auto-detect: valid UTF-8 (with or without BOM) stays UTF-8, anything else is TIS-620", () => {
  const thai = "นางสาวสมหญิง,รักเรียน";
  assert.deepEqual(decodeRosterBytes(Buffer.from(thai, "utf8")), { text: thai, encoding: "utf-8", unmapped: 0 });
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(thai, "utf8")]);
  assert.equal(decodeRosterBytes(bom).text, thai);
  assert.deepEqual(decodeRosterBytes(tis620(thai)), { text: thai, encoding: "tis-620", unmapped: 0 });
  assert.throws(() => decodeRosterBytes(tis620(thai), "utf-8"));
  assert.equal(decodeRosterBytes(tis620(thai), "tis-620").text, thai);
});

test("CSV: quotes, doubled quotes, CRLF and LF, blank lines, trailing newline", () => {
  assert.deepEqual(parseCsv('a,"b,c","say ""hi"""\r\n\r\nd,,e\n'), [["a", "b,c", 'say "hi"'], ["d", "", "e"]]);
  assert.deepEqual(parseCsv("x,y"), [["x", "y"]]);
});

test("registrar format: official TH/EN names, lowercased email, course code and section", () => {
  const read = readRoster(parseCsv(decodeRosterBytes(tis620(registrarCsv(STUDENTS))).text));
  assert.ok(!("error" in read));
  assert.equal(read.format, "registrar");
  assert.deepEqual(read.rows[1], {
    line: 3,
    studentId: "69000002",
    email: "somying.r@example.edu",
    nameTh: "นางสาวสมหญิง รักเรียน",
    nameEn: "Miss SOMYING RAKRIAN",
    courseCode: "999001",
    section: "1",
  });
});

test("simple template; an unrecognised header asks for a mapping instead of failing", () => {
  const simple = readRoster(parseCsv("student_id,name,email\n69000009,สมศรี มีสุข,SomSri@Example.EDU\n"));
  assert.ok(!("error" in simple));
  assert.deepEqual([simple.format, simple.rows[0]!.email, simple.rows[0]!.nameTh, simple.rows[0]!.section], ["simple", "somsri@example.edu", "สมศรี มีสุข", null]);
  const unknown = readRoster(parseCsv("foo,bar\n1,2\n"));
  assert.ok("error" in unknown && unknown.error === "NEEDS_MAPPING");
  assert.deepEqual(unknown.headers, ["foo", "bar"]);
  assert.deepEqual(readRoster([]), { error: "EMPTY_FILE" });
});

test("another institution's Thai header is mapped from synonyms, prefix glued Thai-style", () => {
  const csv = "ลำดับ,รหัสนิสิต,คำนำหน้า,ชื่อ,นามสกุล,อีเมล์,กลุ่มเรียน\n1,B6512345,นางสาว,สมใจ,ดีงาม,somjai@uni.example,02\n";
  const read = readRoster(parseCsv(csv));
  assert.ok(!("error" in read));
  assert.deepEqual(read.mapping, { studentId: "รหัสนิสิต", email: "อีเมล์", nameTh: ["คำนำหน้า", "ชื่อ", "นามสกุล"], nameEn: [], section: "กลุ่มเรียน", courseCode: null });
  assert.deepEqual([read.format, read.rows[0]!.studentId, read.rows[0]!.nameTh, read.rows[0]!.section], ["custom", "B6512345", "นางสาวสมใจ ดีงาม", "02"]);
});

test("English headers with spaces and an English prefix stay space-separated", () => {
  const read = readRoster(parseCsv("Student ID,Title,First Name,Last Name,E-mail\nS-01,Ms.,Jane,Doe,jane@college.example\n"));
  assert.ok(!("error" in read));
  assert.deepEqual([read.mapping.studentId, read.mapping.email, read.rows[0]!.nameTh], ["Student ID", "E-mail", "Ms. Jane Doe"]);
});

test("an explicit mapping overrides the suggestion; unknown columns are rejected", () => {
  const rows = parseCsv("col1,col2,col3\n77,Somchai X,sx@school.example\n");
  const read = readRoster(rows, { studentId: "col1", email: "col3", nameTh: ["col2"], nameEn: [], section: null, courseCode: null });
  assert.ok(!("error" in read));
  assert.deepEqual([read.format, read.rows[0]!.studentId, read.rows[0]!.email, read.rows[0]!.nameTh], ["custom", "77", "sx@school.example", "Somchai X"]);
  const bad = readRoster(rows, { studentId: "nope", email: "col3", nameTh: [], nameEn: [], section: null, courseCode: null });
  assert.ok("error" in bad && bad.error === "INVALID_MAPPING");
});

test("suggestMapping recognises the registrar header exactly", () => {
  assert.deepEqual(suggestMapping(parseCsv(registrarCsv([]))[0]!), {
    studentId: "STUDENTCODE",
    email: "STUDENTEMAIL",
    nameTh: ["PREFIXNAME", "STUDENTNAME", "STUDENTSURNAME"],
    nameEn: ["PREFIXNAMEENG", "STUDENTNAMEENG", "STUDENTSURNAMEENG"],
    section: "SECTION",
    courseCode: "COURSECODE",
  });
});
