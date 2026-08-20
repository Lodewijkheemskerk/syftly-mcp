// Submit every sitemap URL to IndexNow (Bing/Yandex-family instant indexing).
// Run after a production deploy: `npm run indexnow` (or with SITE_URL set).
// Runs directly under Node >= 23 via native type stripping — no build step.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPayload, extractLocs, isIndexNowKeyFile } from "../lib/indexnow.ts";
import { canonical, siteUrl } from "../lib/site.ts";

const PUBLIC_DIR = join(import.meta.dirname, "..", "public");

function findKey(): string {
  const file = readdirSync(PUBLIC_DIR).find(isIndexNowKeyFile);
  if (!file) throw new Error(`no <key>.txt IndexNow key file found in ${PUBLIC_DIR}`);
  const key = file.slice(0, -4);
  const content = readFileSync(join(PUBLIC_DIR, file), "utf8").trim();
  if (content !== key) throw new Error(`key file ${file} does not contain its own key`);
  return key;
}

const key = findKey();
const sitemap = canonical("/sitemap.xml");
const res = await fetch(sitemap);
if (!res.ok) throw new Error(`fetch ${sitemap} -> HTTP ${res.status}`);
const urls = extractLocs(await res.text());
const payload = buildPayload(urls, key, siteUrl());

const submit = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(payload),
});
// 200 = submitted, 202 = accepted pending key validation; anything else is a bug.
console.log(`[indexnow] ${payload.urlList.length} URLs for ${payload.host} -> HTTP ${submit.status}`);
if (!submit.ok && submit.status !== 202) {
  console.error(await submit.text());
  process.exit(1);
}
