import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "@/app/methodology/page";
import { listCategories } from "@/lib/categories";

// The Methodology page is where the honest story lives (ADR 0001/0007/0008/0009):
// every answer is a "light estimate", the verdict is COMPUTED not edited, and the
// caveats (English-leaning WER, token-priced exclusions) are stated up front. The
// test pins the page to the real numbers from the CATEGORY REGISTRY (ADR 0010) —
// all five categories, not the transcription-only MVP-1 snapshot it once showed —
// so it cannot drift into design-fiction or contradict the homepage totals.
function render(): string {
  return renderToStaticMarkup(Page());
}

describe("Methodology page", () => {
  const html = render();
  const rankings = listCategories();

  it("states the confidence model honestly (light estimate, not first-hand)", () => {
    expect(html).toContain("light estimate");
    expect(html.toLowerCase()).toContain("first-hand");
  });

  it("carries the English-leaning WER caveat and attributes the source", () => {
    expect(html.toLowerCase()).toContain("english-leaning");
    expect(html).toContain("Artificial Analysis");
  });

  it("explains the verdict is computed, not edited", () => {
    expect(html.toLowerCase()).toContain("computed");
  });

  it("reports registry-wide scope numbers that match the homepage (no MVP-1 snapshot)", () => {
    const offerings = rankings.reduce((n, r) => n + r.providers.length, 0);
    const queries = rankings.reduce((n, r) => n + Object.keys(r.queries).length, 0);
    expect(html).toContain(String(rankings.length)); // 5 categories, from the registry
    expect(html).toContain(String(offerings)); // 31 offerings, summed over the registry
    expect(html).toContain(String(queries)); // published queries, summed over the registry
    expect(html).not.toContain("MVP-1"); // the stale single-category framing is gone
  });

  it("names every registered category, not just transcription", () => {
    for (const r of rankings) {
      // Labels like "Scraping & browser" render HTML-escaped.
      expect(html).toContain(r.label.replace(/&/g, "&amp;"));
    }
  });

  it("aggregates sources from every category ranking", () => {
    for (const r of rankings) {
      expect(html).toContain(r.bronnen[0].titel);
    }
  });

  it("pluralizes the published-queries stat", () => {
    expect(html).toContain("queries");
  });

  it("keeps internal Dutch jargon out of the public copy", () => {
    expect(html.toLowerCase()).not.toContain("etalage");
    expect(html.toLowerCase()).not.toContain("citeerbare");
  });
});
