// Imports exam-practice packages (ps-practice-package/v1) into the database:
//
//   node dist/scripts/import-practice.js /packages/2026S_IP.json [...]
//
// Packages come from the item bank's export tool and carry question text, answer keys, and
// figures; they are supplied at run time (a read-only mount in the production `migrate` service)
// and never enter this repository. Re-importing identical content is a no-op. Changed content is
// refused, unless `--replace` is given AND no attempt has used that session yet (a correction
// before students start); once attempts exist, history must keep the questions it was scored on.
// `--update-text` (PS-TASK-20260926-848) updates a session in place when only its text changed —
// e.g. a Thai translation added — keeping every question id, answer, option label, category, and
// figure, so attempts, bookmarks, and assignments stay valid; anything structural is refused.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packageHash } from "../activities/engine.js";
import { loadAppConfig } from "../config.js";
import { createDatabasePool, withTransaction, type DatabasePool } from "../db.js";
import { validatePracticePackage, type PracticePackage } from "../practice/package.js";

export type PracticeImportOutcome = { status: "imported" | "unchanged" | "replaced" | "updated"; id: string; contentId: string; contentHash: string };

export class PracticeImportRefused extends Error {}

type Client = Parameters<Parameters<typeof withTransaction>[1]>[0];

// jsonb stores object keys in its own order, so stored and package JSON compare by content.
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Refuses unless `pkg` differs from the stored session only in text (stems, option text, labels of the exam). */
async function assertTextOnly(client: Client, sessionId: string, pkg: PracticePackage) {
  const refuse = (what: string) => {
    throw new PracticeImportRefused(`${pkg.exam.content_id}: --update-text refused, ${what} changed (only text may change)`);
  };
  const e = pkg.exam;
  const s = (await client.query<{ family: string; item_count: number; time_limit_minutes: number | null; categories: unknown; category_provenance: string; answer_key_provenance: string }>(
    "SELECT family, item_count, time_limit_minutes, categories, category_provenance, answer_key_provenance FROM exam_sessions WHERE id = $1",
    [sessionId],
  )).rows[0]!;
  if (s.family !== pkg.family) refuse("the family");
  if (s.item_count !== e.item_count) refuse("the item count");
  if ((s.time_limit_minutes ?? null) !== (e.time_limit_minutes ?? null)) refuse("the time limit");
  if (canon(s.categories) !== canon(e.categories)) refuse("the categories");
  if (s.category_provenance !== e.category_provenance || s.answer_key_provenance !== e.answer_key_provenance) refuse("a provenance");
  const stored = new Map(
    (await client.query<{ content_id: string; seq: number; answer: string; category: string; field: string; figure_en: string | null; figure_th: string | null; options: { label: string }[] }>(
      "SELECT content_id, seq, answer, category, field, figure_en, figure_th, options FROM practice_questions WHERE exam_session_id = $1",
      [sessionId],
    )).rows.map((r) => [r.content_id, r]),
  );
  if (stored.size !== pkg.questions.length) refuse("the question set");
  for (const q of pkg.questions) {
    const r = stored.get(q.content_id);
    if (!r) refuse(`the question set (${q.content_id})`);
    if (r!.seq !== q.seq || r!.answer !== q.answer || r!.category !== q.category || r!.field !== q.field) refuse(`${q.content_id}'s sequence, answer, or category`);
    if ((r!.figure_en ?? null) !== (q.figure?.en ?? null) || (r!.figure_th ?? null) !== (q.figure?.th ?? null)) refuse(`${q.content_id}'s figures`);
    if (r!.options.map((o) => o.label).join(",") !== q.options.map((o) => o.label).join(",")) refuse(`${q.content_id}'s option labels`);
  }
  const figures = (await client.query<{ id: string; sha256: string }>("SELECT id, sha256 FROM practice_figures WHERE exam_session_id = $1", [sessionId])).rows;
  const sig = (list: { id: string; sha256: string }[]) => list.map((f) => `${f.id}:${f.sha256}`).sort().join("|");
  if (sig(figures) !== sig(pkg.figures)) refuse("the figure set");
}

export async function importPracticePackage(
  pool: DatabasePool,
  raw: unknown,
  options: { replace?: boolean; updateText?: boolean } = {},
): Promise<PracticeImportOutcome> {
  const errors = validatePracticePackage(raw);
  if (errors.length > 0) throw new PracticeImportRefused(`invalid package:\n  ${errors.slice(0, 20).join("\n  ")}`);
  const pkg = raw as PracticePackage;
  const contentHash = packageHash(pkg);
  const contentId = pkg.exam.content_id;
  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ id: string; content_hash: string }>(
      "SELECT id, content_hash FROM exam_sessions WHERE content_id = $1 FOR UPDATE",
      [contentId],
    );
    const row = existing.rows[0];
    let status: PracticeImportOutcome["status"] = "imported";
    if (row) {
      if (row.content_hash === contentHash) return { status: "unchanged", id: row.id, contentId, contentHash };
      if (options.updateText) {
        await assertTextOnly(client, row.id, pkg);
        const e = pkg.exam;
        await client.query(
          `UPDATE exam_sessions SET title = $2, subtitle = $3, provider = $4, session_label = $5, languages = $6, attribution = $7,
             translation_note = $8, content_hash = $9 WHERE id = $1`,
          [row.id, e.title, e.subtitle ?? null, e.provider, e.session ?? null, e.languages, e.attribution, e.translation_note ?? null, contentHash],
        );
        for (const q of pkg.questions) {
          await client.query(
            "UPDATE practice_questions SET stem = $3::jsonb, options = $4::jsonb WHERE exam_session_id = $1 AND content_id = $2",
            [row.id, q.content_id, JSON.stringify(q.stem), JSON.stringify(q.options)],
          );
        }
        await client.query(
          `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
           VALUES (NULL, 'practice_package.updated', 'exam_session', $1, $2::jsonb)`,
          [row.id, JSON.stringify({ contentId, contentHash, previousHash: row.content_hash, languages: e.languages })],
        );
        return { status: "updated", id: row.id, contentId, contentHash };
      }
      if (!options.replace) throw new PracticeImportRefused(`${contentId} is already imported with different content (use --replace before any attempt)`);
      const used = await client.query("SELECT 1 FROM practice_attempts WHERE exam_session_id = $1 LIMIT 1", [row.id]);
      const usedByQuiz = await client.query(
        `SELECT 1 FROM practice_attempts AS a
         WHERE EXISTS (SELECT 1 FROM practice_questions AS q WHERE q.exam_session_id = $1 AND q.id = ANY(a.question_ids)) LIMIT 1`,
        [row.id],
      );
      if (used.rowCount || usedByQuiz.rowCount) throw new PracticeImportRefused(`${contentId} already has attempts; import corrected content under a new session id`);
      await client.query("DELETE FROM exam_sessions WHERE id = $1", [row.id]);
      status = "replaced";
    }
    const e = pkg.exam;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO exam_sessions (content_id, family, title, subtitle, provider, session_label, item_count, time_limit_minutes,
         languages, categories, category_provenance, answer_key_provenance, attribution, translation_note, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15) RETURNING id`,
      [contentId, pkg.family, e.title, e.subtitle ?? null, e.provider, e.session ?? null, e.item_count, e.time_limit_minutes ?? null,
        e.languages, JSON.stringify(e.categories), e.category_provenance, e.answer_key_provenance, e.attribution, e.translation_note ?? null, contentHash],
    );
    const id = inserted.rows[0]!.id;
    for (const f of pkg.figures) {
      await client.query("INSERT INTO practice_figures (id, exam_session_id, mime, sha256, data) VALUES ($1, $2, $3, $4, $5)", [
        f.id, id, f.mime, f.sha256, Buffer.from(f.data_base64, "base64"),
      ]);
    }
    for (const q of pkg.questions) {
      await client.query(
        `INSERT INTO practice_questions (exam_session_id, content_id, seq, stem, options, answer, category, field, figure_en, figure_th)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)`,
        [id, q.content_id, q.seq, JSON.stringify(q.stem), JSON.stringify(q.options), q.answer, q.category, q.field, q.figure?.en ?? null, q.figure?.th ?? null],
      );
    }
    await client.query(
      `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
       VALUES (NULL, 'practice_package.imported', 'exam_session', $1, $2::jsonb)`,
      [id, JSON.stringify({ contentId, contentHash, status, questions: pkg.questions.length, figures: pkg.figures.length })],
    );
    return { status, id, contentId, contentHash };
  });
}

async function main(args: string[]) {
  const replace = args.includes("--replace");
  const updateText = args.includes("--update-text");
  const files = args.filter((a) => a !== "--replace" && a !== "--update-text");
  if (files.length === 0 || (replace && updateText)) {
    console.error("usage: import-practice [--replace | --update-text] <package.json> [...]");
    process.exit(2);
  }
  const config = loadAppConfig();
  const pool = createDatabasePool(config.databaseUrl);
  let failed = false;
  try {
    for (const file of files) {
      try {
        const outcome = await importPracticePackage(pool, JSON.parse(await readFile(file, "utf8")), { replace, updateText });
        console.info(`${outcome.status}: ${outcome.contentId} (${outcome.id}, sha256 ${outcome.contentHash})`);
      } catch (error) {
        failed = true;
        console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await pool.end();
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main(process.argv.slice(2));
}
