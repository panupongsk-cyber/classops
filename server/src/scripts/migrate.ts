import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAppConfig } from "../config.js";
import { createDatabasePool } from "../db.js";

const config = loadAppConfig();
const pool = createDatabasePool(config.databaseUrl);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(currentDirectory, "../../migrations");

await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const filenames = (await readdir(migrationsDirectory))
  .filter((filename) => filename.endsWith(".sql"))
  .sort();

for (const filename of filenames) {
  const sql = await readFile(resolve(migrationsDirectory, filename), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const existing = await pool.query<{ checksum: string }>(
    "SELECT checksum FROM schema_migrations WHERE filename = $1",
    [filename],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].checksum !== checksum) {
      throw new Error(`Applied migration changed: ${filename}`);
    }
    continue;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
      [filename, checksum],
    );
    await client.query("COMMIT");
    console.info(`Applied ${filename}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

await pool.end();
