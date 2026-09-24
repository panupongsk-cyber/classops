// Imports one learning-activity package into the database:
//
//   node dist/scripts/import-activity.js /packages/<slug>.json
//
// Packages carry answer keys and live in a private source, never in this repository. The file
// is supplied at run time (e.g. a read-only mount in the production `migrate` service; see the
// plan's "Item Bank, Import Path, and Privacy Boundary"). An existing (slug, version) is never
// modified: re-importing identical content is a no-op, different content is refused.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packageHash, validatePackage, type ActivityPackage } from "../activities/engine.js";
import { loadAppConfig } from "../config.js";
import { createDatabasePool, type DatabasePool } from "../db.js";

export type ImportOutcome =
  | { status: "imported"; id: string; slug: string; version: number; contentHash: string }
  | { status: "unchanged"; id: string; slug: string; version: number; contentHash: string };

export class ImportRefused extends Error {}

export async function importActivityPackage(pool: DatabasePool, raw: unknown): Promise<ImportOutcome> {
  const errors = validatePackage(raw);
  if (errors.length > 0) throw new ImportRefused(`invalid package:\n  ${errors.join("\n  ")}`);
  const pkg = raw as ActivityPackage;
  const contentHash = packageHash(pkg);
  const existing = await pool.query<{ id: string; content_hash: string }>(
    "SELECT id, content_hash FROM activity_packages WHERE slug = $1 AND version = $2",
    [pkg.package, pkg.version],
  );
  const row = existing.rows[0];
  if (row) {
    if (row.content_hash !== contentHash) {
      throw new ImportRefused(
        `${pkg.package} v${pkg.version} is already imported with different content; bump "version" instead`,
      );
    }
    return { status: "unchanged", id: row.id, slug: pkg.package, version: pkg.version, contentHash };
  }
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO activity_packages (slug, version, content_hash, title, languages, spec)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb) RETURNING id`,
    [pkg.package, pkg.version, contentHash, JSON.stringify(pkg.title), pkg.languages, JSON.stringify(pkg)],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("activity package insert returned no id");
  await pool.query(
    `INSERT INTO audit_log (actor_user_id, event_type, subject_type, subject_id, metadata)
     VALUES (NULL, 'activity_package.imported', 'activity_package', $1, $2::jsonb)`,
    [id, JSON.stringify({ slug: pkg.package, version: pkg.version, contentHash })],
  );
  return { status: "imported", id, slug: pkg.package, version: pkg.version, contentHash };
}

async function main(files: string[]) {
  if (files.length === 0) {
    console.error("usage: import-activity <package.json> [...]");
    process.exit(2);
  }
  const config = loadAppConfig();
  const pool = createDatabasePool(config.databaseUrl);
  let failed = false;
  try {
    for (const file of files) {
      try {
        const outcome = await importActivityPackage(pool, JSON.parse(await readFile(file, "utf8")));
        console.info(`${outcome.status}: ${outcome.slug} v${outcome.version} (${outcome.id}, sha256 ${outcome.contentHash})`);
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
