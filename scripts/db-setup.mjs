// One-off, idempotent DB setup: create the telemetry `events` table from
// db/schema.sql and verify the connection. Run with:
//   node --env-file=.env.local scripts/db-setup.mjs
// Reads DATABASE_URL from the environment; never prints the secret.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL ontbreekt — staat die ingevuld in .env.local?");
  process.exit(1);
}

// Supabase transaction pooler (port 6543): no prepared statements, SSL required.
const sql = postgres(url, { prepare: false, ssl: "require" });

try {
  const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  // Drop "--" comment lines before splitting on ";" so a semicolon inside a
  // comment can't break a statement apart.
  const statements = schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await sql.unsafe(stmt);
  }
  const [{ count }] = await sql`select count(*)::int as count from events`;
  console.log(`OK — verbonden, 'events'-tabel klaar, ${count} rijen.`);
} catch (err) {
  console.error("Verbinding/setup mislukt:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
