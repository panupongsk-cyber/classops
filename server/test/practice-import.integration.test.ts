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

  // Option-level figures (PS-TASK-20261012-1760): a packaged figure named from an option is valid;
  // a dangling id is not.
  const withOptFig = syntheticPracticePackage("2099B_XX");
  withOptFig.figures.push({ id: "2099B_XX_Q001_Oa", mime: "image/png", sha256: withOptFig.figures[0]!.sha256, data_base64: withOptFig.figures[0]!.data_base64 });
  withOptFig.questions[0]!.options[0]!.figure = { en: "2099B_XX_Q001_Oa" };
  assert.deepEqual(validatePracticePackage(withOptFig), []);
  // Explanations (PS-TASK-20261013-1777): both languages are required when the exam lists th.
  const withExplanation = syntheticPracticePackage("2099D_XX");
  withExplanation.questions[0]!.explanation = { en: "Because X.", th: "เพราะ X" };
  assert.deepEqual(validatePracticePackage(withExplanation), []);
  const missingTh = syntheticPracticePackage("2099E_XX");
  missingTh.questions[0]!.explanation = { en: "Because X." };
  assert.match(validatePracticePackage(missingTh).join("\n"), /explanation\.th: required/);

  const dangling = syntheticPracticePackage("2099C_XX");
  dangling.questions[0]!.options[1]!.figure = { en: "2099C_XX_Q001_Oz" };
  assert.match(validatePracticePackage(dangling).join("\n"), /options\[1\]\.figure\.en: must name a packaged figure/);
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

    // --update-text (PS-TASK-20260926-848): text-only changes land in place, keeping ids and attempts.
    const before = (await pool.query<{ id: string; content_id: string }>("SELECT id, content_id FROM practice_questions ORDER BY seq")).rows;
    const sessionBefore = (await pool.query<{ id: string }>("SELECT id FROM exam_sessions")).rows[0]!.id;
    const retranslated = syntheticPracticePackage();
    // Real packages list category keys as {field, name}; jsonb stores them in its own order.
    retranslated.exam.categories = retranslated.exam.categories.map((c) => ({ field: c.field, name: c.name }));
    retranslated.questions[0]!.stem = { en: "Corrected wording?", th: "ถ้อยคำที่แก้แล้ว" };
    retranslated.questions[1]!.options[2]!.text = { en: "option c (reworded)", th: "ตัวเลือก c ที่เรียบเรียงใหม่" };
    retranslated.exam.translation_note = "Thai text is an unofficial translation made for this course, not an ITPEC edition.";
    const updated = await importPracticePackage(pool, retranslated, { updateText: true });
    assert.equal(updated.status, "updated");
    assert.equal(updated.id, sessionBefore, "the same exam session row");
    assert.deepEqual((await pool.query<{ id: string; content_id: string }>("SELECT id, content_id FROM practice_questions ORDER BY seq")).rows, before, "question ids are kept");
    assert.equal((await pool.query("SELECT 1 FROM practice_attempts")).rowCount, 1, "the attempt survives");
    const q1 = (await pool.query<{ stem: { en: string; th: string } }>("SELECT stem FROM practice_questions WHERE seq = 1")).rows[0]!;
    assert.deepEqual(q1.stem, { en: "Corrected wording?", th: "ถ้อยคำที่แก้แล้ว" });
    assert.equal((await pool.query<{ options: { text: { th: string } }[] }>("SELECT options FROM practice_questions WHERE seq = 2")).rows[0]!.options[2]!.text.th, "ตัวเลือก c ที่เรียบเรียงใหม่");
    assert.match((await pool.query<{ translation_note: string }>("SELECT translation_note FROM exam_sessions")).rows[0]!.translation_note, /unofficial/);
    assert.equal((await importPracticePackage(pool, retranslated, { updateText: true })).status, "unchanged", "idempotent after the update");
    assert.equal((await pool.query("SELECT 1 FROM audit_log WHERE event_type = 'practice_package.updated'")).rowCount, 1);

    // Option-level figure additions land in place (PS-TASK-20261012-1760), even with an attempt.
    const withOptFigs = syntheticPracticePackage();
    withOptFigs.questions[0]!.stem = { en: "Corrected wording?", th: "ถ้อยคำที่แก้แล้ว" }; // the stored text after the update above
    withOptFigs.exam.categories = withOptFigs.exam.categories.map((c) => ({ field: c.field, name: c.name }));
    withOptFigs.exam.translation_note = "Thai text is an unofficial translation made for this course, not an ITPEC edition.";
    const figsBefore = (await pool.query("SELECT 1 FROM practice_figures")).rowCount;
    for (const label of ["a", "b", "c", "d"]) {
      const fid = `2099S_XX_Q001_O${label}`;
      withOptFigs.figures.push({ id: fid, mime: "image/png", sha256: withOptFigs.figures[0]!.sha256, data_base64: withOptFigs.figures[0]!.data_base64 });
      withOptFigs.questions[0]!.options.find((o) => o.label === label)!.figure = { en: fid };
    }
    const figAdded = await importPracticePackage(pool, withOptFigs, { updateText: true });
    assert.equal(figAdded.status, "updated");
    assert.equal(figAdded.id, sessionBefore, "the same exam session row");
    assert.equal((await pool.query("SELECT 1 FROM practice_figures")).rowCount, figsBefore! + 4, "the new figures are stored");
    assert.deepEqual((await pool.query<{ id: string; content_id: string }>("SELECT id, content_id FROM practice_questions ORDER BY seq")).rows, before, "question ids are kept");
    assert.equal((await pool.query("SELECT 1 FROM practice_attempts")).rowCount, 1, "the attempt survives the figure addition");
    const q0opts = (await pool.query<{ options: { label: string; figure?: { en: string } }[] }>("SELECT options FROM practice_questions WHERE seq = 1")).rows[0]!.options;
    assert.equal(q0opts[0]!.figure!.en, "2099S_XX_Q001_Oa", "the option figure reference is stored");
    // A second identical update is a no-op, and removing a stored figure is still refused.
    assert.equal((await importPracticePackage(pool, withOptFigs, { updateText: true })).status, "unchanged", "idempotent after the figure addition");
    const removed = structuredClone(withOptFigs);
    removed.figures = removed.figures.filter((f) => f.id !== "2099S_XX_Q001_Oa");
    delete removed.questions[0]!.options[0]!.figure;
    await assert.rejects(importPracticePackage(pool, removed, { updateText: true }), /--update-text refused/, "figure removal must stay refused");

    // Anything structural is refused, even in --update-text mode.
    const structural: [string, (p: ReturnType<typeof syntheticPracticePackage>) => void][] = [
      ["answer", (p) => { p.questions[0]!.answer = "a"; }],
      ["option labels", (p) => { p.questions[1]!.options[3]!.label = "e"; if (p.questions[1]!.answer === "d") p.questions[1]!.answer = "e"; }],
      ["categories", (p) => { p.questions[2]!.category = "Alpha"; p.questions[2]!.field = "Strategy"; }],
      ["time limit", (p) => { p.exam.time_limit_minutes = 20; }],
      ["figures", (p) => { p.questions[1]!.figure = null; p.figures = []; }],
    ];
    for (const [what, mutate] of structural) {
      const pkg = syntheticPracticePackage();
      pkg.questions[0]!.stem = { en: "Corrected wording?", th: "ถ้อยคำที่แก้แล้ว" };
      mutate(pkg);
      await assert.rejects(importPracticePackage(pool, pkg, { updateText: true }), /--update-text refused/, what);
    }
    assert.deepEqual((await pool.query<{ answer: string }>("SELECT answer FROM practice_questions ORDER BY seq")).rows.map((r) => r.answer), ["b", "c", "a", "d"], "refusals change nothing");

    const audits = await pool.query("SELECT 1 FROM audit_log WHERE event_type = 'practice_package.imported'");
    assert.equal(audits.rowCount, 2);
    assert.equal((await pool.query<{ practice_enabled: boolean }>("SELECT practice_enabled FROM sections WHERE id = $1", [section])).rows[0]!.practice_enabled, false, "off by default");
  } finally {
    await pool.end();
  }
});
