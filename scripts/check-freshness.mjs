// Data freshness gate (plain Node, no TS imports). Syftly's promise is that the
// hand-maintained data/*.ranking.json rankings are refreshed on a monthly cadence
// — but nothing made that promise mechanically visible. This script does: it
// measures the age of each ranking's `laatst_bijgewerkt` (the refresh date) and
//   - WARNs (exit 0) once a category is older than WARN_DAYS,
//   - FAILs (exit 1) once it crosses FAIL_DAYS,
// so `npm run build`/`validate` nag as data ages and hard-stop before it becomes
// embarrassing. The oldest underlying `bron_datum` is printed as context only: a
// source (e.g. a benchmark) can legitimately predate the refresh, so it never
// drives the exit code — only the refresh promise does.
//
// Output is deliberately greppable: every line is prefixed `[syftly:freshness]`.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const WARN_DAYS = 35;
const FAIL_DAYS = 90;
const PREFIX = "[syftly:freshness]";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "..", "data");

// Whole-day difference between two YYYY-MM-DD dates, computed in UTC so it never
// drifts with local timezones or DST.
function daysBetween(isoFrom, isoTo) {
  const a = Date.parse(`${isoFrom}T00:00:00Z`);
  const b = Date.parse(`${isoTo}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const today = todayIso();
const files = readdirSync(dataDir)
  .filter((f) => f.endsWith(".ranking.json"))
  .sort();

if (files.length === 0) {
  console.error(`${PREFIX} FAIL — no data/*.ranking.json files found in ${dataDir}`);
  process.exit(1);
}

let worst = "OK"; // OK -> WARN -> FAIL
let failed = false;

for (const file of files) {
  const raw = readFileSync(join(dataDir, file), "utf8");
  const ranking = JSON.parse(raw);
  const category = ranking.category ?? file.replace(/\.ranking\.json$/, "");

  const refreshed = ranking.laatst_bijgewerkt;
  const refreshAge = daysBetween(refreshed, today);

  // Oldest source date across providers + bronnen — context only.
  const bronDates = [
    ...ranking.providers.map((p) => p.bron_datum),
    ...ranking.bronnen.map((b) => b.datum),
  ].filter(Boolean);
  const oldestBron = bronDates.sort()[0] ?? refreshed;
  const bronAge = daysBetween(oldestBron, today);

  let status = "OK";
  if (refreshAge > FAIL_DAYS) {
    status = "FAIL";
    failed = true;
    worst = "FAIL";
  } else if (refreshAge > WARN_DAYS) {
    status = "WARN";
    if (worst === "OK") worst = "WARN";
  }

  const line =
    `${PREFIX} ${status.padEnd(4)} ${category.padEnd(14)} ` +
    `refreshed ${refreshed} (${refreshAge}d ago) ` +
    `[oldest source ${oldestBron}, ${bronAge}d]`;
  if (status === "FAIL") console.error(line);
  else console.log(line);
}

console.log(
  `${PREFIX} summary — ${files.length} categories checked, worst=${worst} ` +
    `(warn>${WARN_DAYS}d, fail>${FAIL_DAYS}d, measured against ${today})`,
);

process.exit(failed ? 1 : 0);
