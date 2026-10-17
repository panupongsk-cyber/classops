import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageHash } from "../activities/engine.js";
import { loadAppConfig } from "../config.js";
import { createDatabasePool, withTransaction, type DatabasePool } from "../db.js";
import { validateLibraryPackage, type LibraryPackage } from "../library/package.js";

export async function importLibraryPackage(pool: DatabasePool, raw: unknown) {
  const errors = validateLibraryPackage(raw);
  if (errors.length) throw new Error(`Invalid library package: ${errors.join("; ")}`);
  const pkg = raw as LibraryPackage;
  const revision = packageHash(pkg);
  const { paper } = pkg;
  const id = paper.exam.content_id;
  return withTransaction(pool, async (client) => {
    // Serialize imports even when the paper does not yet have a row.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`library:${id}`]);
    const existing = (await client.query<{ revision: string }>("SELECT revision FROM library_exams WHERE source_id=$1", [id])).rows[0];
    if (existing?.revision === revision) return { status: "unchanged", id, revision };
    if (existing) throw new Error("Changed library content refused; version activation is a later release");
    await client.query("INSERT INTO library_exams (source_id,revision,source_commit,source_path,metadata) VALUES ($1,$2,$3,$4,$5::jsonb)",
      [id, revision, pkg.source.commit, pkg.source.path, JSON.stringify({ ...paper.exam, family: paper.family })]);
    for (const q of paper.questions) {
      await client.query("INSERT INTO library_questions (exam_id,source_id,seq,content) VALUES ($1,$2,$3,$4::jsonb)", [id, q.content_id, q.seq, JSON.stringify(q)]);
    }
    for (const f of paper.figures) {
      await client.query("INSERT INTO library_figures (exam_id,source_id,sha256,data) VALUES ($1,$2,$3,$4)", [id, f.id, f.sha256, Buffer.from(f.data_base64, "base64")]);
    }
    return { status: "imported", id, revision };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 3) throw new Error("usage: import-library <package.json>");
  const pool = createDatabasePool(loadAppConfig().databaseUrl);
  try {
    console.info(await importLibraryPackage(pool, JSON.parse(await readFile(process.argv[2]!, "utf8"))));
  } finally { await pool.end(); }
}
