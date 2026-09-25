import assert from "node:assert/strict";
import test from "node:test";

import { createDatabasePool } from "../src/db.js";
import { validatePracticePackage } from "../src/practice/package.js";
import { importPracticePackage, PracticeImportRefused } from "../src/scripts/import-practice.js";
import { syntheticPracticePackage, TINY_PNG } from "./fixtures/synthetic-practice.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("practice package validation catches broken content", () => {
  assert.deepEqual(validatePracticePackage(syntheticPracticePackage()), []);
  const broken = syntheticPracticePackage();
  broken.questions[0]!.answer = "z";
  broken.questions[1]!.options[1]!.label = "a";
  broken.questions[2]!.category = "Gamma";
  broken.questions[3]!.stem = { en: "only english" };
  broken.figures[0]!.sha256 = "0".repeat(64);
  broken.exam.item_count = 5;
  const errors = validatePracticePackage(broken).join("\n");
  for (const expected of ["answer: must be one of the option labels", "unique single-letter labels", "must be one of $.exam.categories", "stem.th: required", "sha256: does not match", "item_count"]) {
    assert.ok(errors.includes(expected), `missing: ${expected}\n${errors}`);
  }
  const noThai = syntheticPracticePackage("2099A_XX", false);
  assert.deepEqual(validatePracticePackage(noThai), []);
});

test("practice import: idempotent, refuses changed content, replaces only before attempts", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return;
  const pool = createDatabasePool(databaseUrl);
  await pool.query("TRUNCATE practice_answers, practice_attempts, practice_questions, practice_figures, exam_sessions, audit_log RESTART IDENTITY CASCADE");
  try {
    const first = await importPracticePackage(pool, syntheticPracticePackage());
    assert.equal(first.status, "imported");
    assert.equal((await importPracticePackage(pool, syntheticPracticePackage())).status, "unchanged");

    const q = await pool.query<{ content_id: string; answer: string; stem: { en: string; th: string }; figure_en: string | null }>(
      "SELECT content_id, answer, stem, figure_en FROM practice_questions ORDER BY seq",
    );
    assert.deepEqual(q.rows.map((r) => r.answer), ["b", "c", "a", "d"]);
    assert.equal(q.rows[0]!.stem.th, "คำถามสังเคราะห์ 1");
    assert.equal(q.rows[1]!.figure_en, "2099S_XX_Q002_en");
    const fig = await pool.query<{ data: Buffer }>("SELECT data FROM practice_figures WHERE id = '2099S_XX_Q002_en'");
    assert.ok(fig.rows[0]!.data.equals(TINY_PNG), "figure bytes round-trip");
    const session = await pool.query<{ languages: string[]; attribution: string; categories: { name: string }[] }>("SELECT languages, attribution, categories FROM exam_sessions");
    assert.deepEqual([session.rows[0]!.languages, session.rows[0]!.categories.length], [["en", "th"], 2]);

    const changed = syntheticPracticePackage();
    changed.questions[0]!.stem.en = "Corrected wording?";
    await assert.rejects(importPracticePackage(pool, changed), PracticeImportRefused);
    assert.equal((await importPracticePackage(pool, changed, { replace: true })).status, "replaced", "a correction before any attempt");
    assert.equal((await pool.query<{ stem: { en: string } }>("SELECT stem FROM practice_questions WHERE seq = 1")).rows[0]!.stem.en, "Corrected wording?");

    // Once an attempt uses the session, even --replace is refused.
    const user = (await pool.query<{ id: string }>("INSERT INTO users (email, display_name, status) VALUES ('p@example.com', 'P', 'active') RETURNING id")).rows[0]!.id;
    const course = (await pool.query<{ id: string }>("INSERT INTO courses (code, title, type) VALUES ('PRAC1', 'P', 'semester') RETURNING id")).rows[0]!.id;
    const section = (await pool.query<{ id: string }>("INSERT INTO sections (course_id, term, join_code) VALUES ($1, 't', 'PRACJOIN') RETURNING id", [course])).rows[0]!.id;
    const qids = (await pool.query<{ id: string }>("SELECT id FROM practice_questions ORDER BY seq")).rows.map((r) => r.id);
    await pool.query(
      "INSERT INTO practice_attempts (user_id, section_id, mode, exam_session_id, lang, question_ids) VALUES ($1, $2, 'quiz', NULL, 'en', $3::uuid[])",
      [user, section, qids.slice(0, 2)],
    );
    const again = syntheticPracticePackage();
    again.questions[0]!.stem.en = "Second correction?";
    await assert.rejects(importPracticePackage(pool, again, { replace: true }), /already has attempts/);

    const audits = await pool.query("SELECT 1 FROM audit_log WHERE event_type = 'practice_package.imported'");
    assert.equal(audits.rowCount, 2);
    assert.equal((await pool.query<{ practice_enabled: boolean }>("SELECT practice_enabled FROM sections WHERE id = $1", [section])).rows[0]!.practice_enabled, false, "off by default");
  } finally {
    await pool.end();
  }
});
