import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here,"..","migrations");

export async function migrate(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock(82910421)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`);
    const files = (await readdir(migrationsDir)).filter((file)=>file.endsWith(".sql")).sort();
    for (const filename of files) {
      const exists = await client.query("SELECT 1 FROM schema_migrations WHERE filename=$1",[filename]);
      if (exists.rowCount) continue;
      const sql = await readFile(join(migrationsDir,filename),"utf8");
      await client.query("BEGIN");
      try { await client.query(sql); await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)",[filename]); await client.query("COMMIT"); console.log(`applied migration ${filename}`); }
      catch (error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally { await client.query("SELECT pg_advisory_unlock(82910421)"); client.release(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) migrate().then(()=>db.end()).catch((error)=>{console.error(error);process.exitCode=1;});
