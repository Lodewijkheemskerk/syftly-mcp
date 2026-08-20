// End-to-end smoke test for north-star telemetry. Drives the running dev server
// through the PIN gate (direct gate cookie), fires a few endpoint calls, then
// confirms they landed in the events table via the protected metrics endpoint.
// Run with: node --env-file=.env.local scripts/smoke-telemetry.mjs
import { setTimeout as delay } from "node:timers/promises";

const BASE = `http://localhost:${process.env.PORT ?? 3100}`;
const COOKIE = "syftly_access=syftly-unlocked-v1"; // GATE_COOKIE=GATE_TOKEN
const secret = process.env.METRICS_SECRET;
if (!secret) {
  console.error("METRICS_SECRET ontbreekt in env");
  process.exit(1);
}

async function metrics() {
  const r = await fetch(`${BASE}/api/internal/metrics?days=1`, {
    headers: { cookie: COOKIE, "x-metrics-secret": secret },
  });
  if (!r.ok) throw new Error(`metrics ${r.status}`);
  return r.json();
}

// Wait for the dev server to be ready (/unlock is gate-exempt).
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/unlock`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await delay(1000);
  }
  throw new Error("dev server kwam niet op");
}

await waitReady();

// Warm the answer route once (dev compiles on first hit), then read baseline.
await fetch(`${BASE}/api/answer?query=warmup`, { headers: { cookie: COOKIE, "user-agent": "smoke-warm" } });
await delay(500);
const before = await metrics();

// Two calls from the same caller (same UA, no key) + one with an explicit key.
await fetch(`${BASE}/api/answer?query=best+transcription+api+for+dutch`, { headers: { cookie: COOKIE, "user-agent": "smoke-A" } });
await fetch(`${BASE}/api/answer?query=cheapest+transcription+api`, { headers: { cookie: COOKIE, "user-agent": "smoke-A" } });
await fetch(`${BASE}/api/answer?query=ocr+api`, { headers: { cookie: COOKIE, "user-agent": "smoke-B", "x-api-key": "smoke-key-1" } });

// Wait for the after() flushes to land in Postgres.
let after = before;
for (let i = 0; i < 12; i++) {
  await delay(500);
  after = await metrics();
  if (after.totalCalls >= before.totalCalls + 3) break;
}

console.log("baseline :", JSON.stringify(before));
console.log("na 3 calls:", JSON.stringify(after));
const delta = after.totalCalls - before.totalCalls;
console.log(delta >= 3 ? `OK — ${delta} calls geregistreerd in de DB` : `LET OP — slechts ${delta} geregistreerd`);
