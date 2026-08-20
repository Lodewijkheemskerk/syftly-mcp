import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page, { homeModel } from "@/app/page";
import { listCategories } from "@/lib/categories";
import { listEtalage } from "@/lib/artefact";
import type { CategorieRanking } from "@/lib/types";

// The landing page / is the crawl-hub and human entry point (L2). Answer-first:
// it leads with what Syftly is (H1 + hap), then links into every registered
// category and a featured real etalage query per category — so crawlers discover
// the AEO pages and a human is oriented in one screen. Every figure and link is
// derived from the registry (ADR 0010), so it can never drift into dead links or
// a faked "coming soon" grid (ADR 0009).
function render(): string {
  return renderToStaticMarkup(Page());
}

describe("Landing page /", () => {
  const html = render();

  it("leidt met het product-antwoord: H1 + hap", () => {
    expect(html).toMatch(
      /<h1[^>]*>\s*The decision layer for the tools AI agents buy\s*<\/h1>/,
    );
    // The hap carries the core promise and stays honest about depth.
    expect(html).toContain('class="hap"');
    expect(html).toContain("which API to call for a task");
  });

  it("labelt het zekerheidsniveau eerlijk", () => {
    expect(html).toContain("light estimate");
  });

  it("toont elke geregistreerde categorie met zijn echte cijfers + een link erin", () => {
    for (const r of listCategories()) {
      // Labels render as HTML, so "&" comes out as the entity "&amp;".
      const labelHtml = r.label.replace(/&/g, "&amp;");
      expect(html).toContain(labelHtml); // e.g. "Transcription" / "Scraping &amp; browser"
      expect(html).toContain(String(r.providers.length)); // offerings count, from data
      expect(html).toContain(`/${r.category}/`); // links into its own category segment
    }
  });

  it("linkt naar de echte secties (categories, methodology, for agents)", () => {
    expect(html).toContain('href="/categories"');
    expect(html).toContain('href="/methodology"');
    expect(html).toContain('href="/for-agents"');
  });

  it("heeft géén dode links: elke antwoord-link is een bestaande etalage-pagina", () => {
    const etalage = new Set(listEtalage().map((e) => `/${e.category}/${e.query}`));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    // Two-segment internal links are answer pages; section/home links have one segment.
    const answerLinks = hrefs.filter((h) => /^\/[a-z-]+\/[a-z0-9-]+$/.test(h));
    expect(answerLinks.length).toBeGreaterThan(0);
    for (const href of answerLinks) {
      expect(etalage.has(href)).toBe(true);
    }
  });

  it("fakt géén ongebouwde inhoud", () => {
    expect(html.toLowerCase()).not.toContain("coming soon");
  });
});

// The hub is registry-driven, proven at the unit: feeding two rankings shows the
// model iterates the registry in order and derives every figure/link from the
// data — never hard-coded here (mirrors the categoryCards pattern).
describe("homeModel: registry-gedreven", () => {
  function fakeRanking(id: string, slug: string, offerings: number): CategorieRanking {
    return {
      category: id,
      label: id.toUpperCase(),
      zekerheidslabel: "light estimate",
      laatst_bijgewerkt: "2026-02-02",
      assen: [],
      providers: Array.from({ length: offerings }, (_, i) => ({
        naam: `${id}-offer-${i}`,
        provider: `Co${i}`,
        prijs: { waarde: i + 1, eenheid: "$/x", vergelijkbaar: true },
        metrics: {},
        sterk: "s",
        zwak: "z",
        bron: "b",
        bron_datum: "2026-01-01",
      })),
      bronnen: [],
      queries: {
        [slug]: { query: `q-${id}`, hap: "h", recommendation: { default: `${id}-offer-0`, axes: {} } },
      },
    };
  }

  const model = homeModel([fakeRanking("alpha", "q-a", 2), fakeRanking("beta", "q-b", 3)]);

  it("itereert de hele registry, in volgorde", () => {
    expect(model.categories.map((c) => c.category)).toEqual(["alpha", "beta"]);
  });

  it("leidt de categorie-cijfers en -links af uit de ranking", () => {
    expect(model.categories[0].offerings).toBe(2);
    expect(model.categories[1].offerings).toBe(3);
    expect(model.categories[0].queries).toBe(1);
    expect(model.categories[0].href).toBe("/alpha/q-a");
  });

  it("kiest één featured etalage-query per categorie, met de echte vraagtekst", () => {
    expect(model.featured.map((f) => f.href)).toEqual(["/alpha/q-a", "/beta/q-b"]);
    expect(model.featured[0].query).toBe("q-alpha");
    expect(model.featured[0].category).toBe("alpha");
  });

  it("telt de totalen op uit de registry", () => {
    expect(model.totals).toEqual({ categories: 2, offerings: 5, queries: 2 });
  });
});
