import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env.local before running migrations.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    create table if not exists public.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const { rows: applied } = await pool.query("select name from public.schema_migrations");
  const appliedNames = new Set(applied.map((row) => row.name));

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedNames.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`apply ${file}`);
    await pool.query(sql);
    await pool.query("insert into public.schema_migrations (name) values ($1)", [file]);
  }

  console.log("Migrations complete.");
  await pool.end();
}

main().catch(async (error) => {
  console.error("Migration failed:", error);
  await pool.end();
  process.exit(1);
});
