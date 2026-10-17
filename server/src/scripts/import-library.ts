import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageHash } from "../activities/engine.js";
import { loadAppConfig } from "../config.js";
import { createDatabasePool, withTransaction, type DatabasePool } from "../db.js";
import { validateLibraryPackage, type LibraryPackage } from "../library/package.js";

// Legacy initial import is available until managed release activation takes ownership.
function questionCore(q: Record<string, unknown>) {
  const options = (q.options as Record<string,unknown>[]).map(o => ({label:o.label,text:o.text,figure:o.figure ?? null}));
  return {content_id:q.content_id,seq:q.seq,stem:q.stem,options,answer:q.answer,category:q.category ?? null,
    field:q.field ?? null,figure:q.figure ?? null,explanation:q.explanation ?? null,
    source_number:q.source_number ?? String(q.seq),question_type:q.question_type ?? "multiple_choice",
    table:q.table ?? null,voided:q.voided ?? false,answer_alternatives:q.answer_alternatives ?? []};
}
function examCore(e: Record<string,unknown>) {
  return Object.fromEntries(["content_id","title","subtitle","provider","session","item_count","languages","attribution"].map(k=>[k,e[k]??null]));
}

export async function importLibraryPackage(pool: DatabasePool, raw: unknown) {
  const errors = validateLibraryPackage(raw);
  if (errors.length) throw new Error(`Invalid library package: ${errors.join("; ")}`);
  const pkg = raw as LibraryPackage;
  const revision = packageHash(pkg);
  const { paper } = pkg;
  const id = paper.exam.content_id;
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('library:publication'))");
    if((await client.query('SELECT 1 FROM library_release_state WHERE singleton')).rowCount)throw Error('Managed releases active; use publish-library preview/activate');
    // Serialize imports even when the paper does not yet have a row.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`library:${id}`]);
    const existing = (await client.query<{ revision: string }>("SELECT revision FROM library_exams WHERE source_id=$1", [id])).rows[0];
    if (existing?.revision === revision) return { status: "unchanged", id, revision };
    if (existing) {
      // A later repository snapshot may contain byte-for-byte identical paper content.
      // Preserve the first publication and all stable IDs, rather than requiring a replacement.
      const stored = (await client.query<{metadata: Record<string,unknown>}>("SELECT metadata FROM library_exams WHERE source_id=$1",[id])).rows[0]!;
      const {family,...exam}=stored.metadata;
      const questions=(await client.query("SELECT content FROM library_questions WHERE exam_id=$1 ORDER BY seq",[id])).rows.map(r=>r.content);
      const figures=(await client.query<{source_id:string;sha256:string;data:Buffer}>("SELECT source_id,sha256,data FROM library_figures WHERE exam_id=$1 ORDER BY source_id COLLATE \"C\"",[id])).rows.map(f=>({id:f.source_id,mime:"image/png",sha256:f.sha256,data_base64:f.data.toString("base64")}));
      if(packageHash({format:paper.format,family,exam,questions,figures})===packageHash(paper))return {status:"unchanged",id,revision:existing.revision};
      if(pkg.format === "ps-library-package/v2" && !("source_notes" in exam)
        && family === paper.family && packageHash(examCore(exam)) === packageHash(examCore(paper.exam))
        && packageHash(questions.map(questionCore)) === packageHash(paper.questions.map(q=>questionCore(q as unknown as Record<string,unknown>)))
        && packageHash(figures) === packageHash(paper.figures)) {
        // Preserve every stable item row and all content used by T1; add source-format metadata.
        await client.query("UPDATE library_exams SET metadata=$2::jsonb,revision=$3,source_commit=$4,source_path=$5 WHERE source_id=$1",
          [id,JSON.stringify({...paper.exam,family:paper.family}),revision,pkg.source.commit,pkg.source.path]);
        for(const q of paper.questions) await client.query("UPDATE library_questions SET content=$3::jsonb WHERE exam_id=$1 AND source_id=$2",[id,q.content_id,JSON.stringify(q)]);
        return {status:"upgraded",id,revision};
      }
      throw new Error("Changed library content refused; version activation is a later release");
    }
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
  if (process.argv.length < 3) throw new Error("usage: import-library <package.json> [...]");
  const pool = createDatabasePool(loadAppConfig().databaseUrl);
  try {
    for (const file of process.argv.slice(2)) console.info(await importLibraryPackage(pool, JSON.parse(await readFile(file, "utf8"))));
  } finally { await pool.end(); }
}
