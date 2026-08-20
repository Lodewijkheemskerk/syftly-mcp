// IndexNow (indexnow.org): push-based indexing for Bing/Yandex-family engines.
// The site proves key ownership by serving public/<key>.txt; the submit script
// (scripts/indexnow-submit.ts) pings api.indexnow.org with the sitemap URLs.
// Pure helpers live here so they are unit-testable without network or fs.

const LOC_RE = /<loc>(.*?)<\/loc>/g;

/** All <loc> values from a sitemap XML, in document order, XML-entity-decoded. */
export function extractLocs(xml: string): string[] {
  return [...xml.matchAll(LOC_RE)].map(([, loc]) =>
    loc
      .trim()
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'")
      .replaceAll("&amp;", "&"),
  );
}

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/** The api.indexnow.org request body. IndexNow accepts one host per ping, so
 * URLs on any other host are dropped rather than poisoning the whole batch. */
export function buildPayload(urls: string[], key: string, origin: string): IndexNowPayload {
  const host = new URL(origin).hostname;
  const urlList = urls.filter((u) => {
    try {
      return new URL(u).hostname === host;
    } catch {
      return false;
    }
  });
  if (urlList.length === 0) throw new Error(`no URLs on host ${host} to submit`);
  return { host, key, keyLocation: `${origin}/${key}.txt`, urlList };
}

/** The key file is named after the key itself: 32 lowercase hex chars + .txt. */
export function isIndexNowKeyFile(name: string): boolean {
  return /^[0-9a-f]{32}\.txt$/.test(name);
}
