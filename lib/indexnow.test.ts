import { describe, expect, it } from "vitest";
import { buildPayload, extractLocs, isIndexNowKeyFile } from "@/lib/indexnow";

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://syftly.vercel.app</loc><lastmod>2026-08-20</lastmod></url>
<url><loc>https://syftly.vercel.app/categories</loc></url>
<url><loc>https://syftly.vercel.app/transcription/cheapest-transcription-api?a=1&amp;b=2</loc></url>
</urlset>`;

describe("extractLocs", () => {
  it("pulls every <loc> and decodes XML entities", () => {
    expect(extractLocs(SITEMAP)).toEqual([
      "https://syftly.vercel.app",
      "https://syftly.vercel.app/categories",
      "https://syftly.vercel.app/transcription/cheapest-transcription-api?a=1&b=2",
    ]);
  });

  it("returns empty for XML without locs", () => {
    expect(extractLocs("<urlset></urlset>")).toEqual([]);
  });
});

describe("buildPayload", () => {
  const key = "a".repeat(32);

  it("derives host and keyLocation from the origin", () => {
    const p = buildPayload(["https://syftly.vercel.app/categories"], key, "https://syftly.vercel.app");
    expect(p).toEqual({
      host: "syftly.vercel.app",
      key,
      keyLocation: `https://syftly.vercel.app/${key}.txt`,
      urlList: ["https://syftly.vercel.app/categories"],
    });
  });

  it("drops URLs on a different host (IndexNow requires one host per ping)", () => {
    const p = buildPayload(
      ["https://syftly.vercel.app/x", "https://evil.example/y"],
      key,
      "https://syftly.vercel.app",
    );
    expect(p.urlList).toEqual(["https://syftly.vercel.app/x"]);
  });

  it("throws when nothing is left to submit", () => {
    expect(() => buildPayload([], key, "https://syftly.vercel.app")).toThrow(/no urls/i);
  });
});

describe("isIndexNowKeyFile", () => {
  it("matches exactly a 32-hex .txt filename", () => {
    expect(isIndexNowKeyFile("0f9c2d4e6a8b0c1d2e3f4a5b6c7d8e9f.txt")).toBe(true);
    expect(isIndexNowKeyFile("readme.txt")).toBe(false);
    expect(isIndexNowKeyFile("0f9c2d4e6a8b0c1d2e3f4a5b6c7d8e9f.md")).toBe(false);
    expect(isIndexNowKeyFile("0F9C2D4E6A8B0C1D2E3F4A5B6C7D8E9F.txt")).toBe(false);
  });
});
