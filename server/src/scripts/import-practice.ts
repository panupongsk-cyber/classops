// Imports exam-practice packages (ps-practice-package/v1) into the database:
//
//   node dist/scripts/import-practice.js /packages/2026S_IP.json [...]
//
// Packages come from the item bank's export tool and carry question text, answer keys, and
// figures; they are supplied at run time (a read-only mount in the production `migrate` service)
// and never enter this repository. Re-importing identical content is a no-op. Changed content is
// refused, unless `--replace` is given AND no attempt has used that session yet (a correction
// before students start); once attempts exist, history must keep the questions it was scored on.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packageHash } from "../activities/engine.js";
import { loadAppConfig } from "../config.js";
import { createDatabasePool, withTransaction, type DatabasePool } from "../db.js";
import { validatePracticePackage, type PracticePackage } from "../practice/package.js";

export type PracticeImportOutcome = { status: "imported" | "unchanged" | "replaced"; id: string; contentId: string; contentHash: string };

export class PracticeImportRefused extends Error {}

export async function importPracticePackage(pool: DatabasePool, raw: unknown, options: { replace?: boolean } = {}): Promise<PracticeImportOutcome> {
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
  const files = args.filter((a) => a !== "--replace");
  if (files.length === 0) {
    console.error("usage: import-practice [--replace] <package.json> [...]");
    process.exit(2);
  }
  const config = loadAppConfig();
  const pool = createDatabasePool(config.databaseUrl);
  let failed = false;
  try {
    for (const file of files) {
      try {
        const outcome = await importPracticePackage(pool, JSON.parse(await readFile(file, "utf8")), { replace });
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
