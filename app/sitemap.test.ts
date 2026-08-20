import { describe, it, expect } from "vitest";
import sitemap from "@/app/sitemap";
import { listEtalage } from "@/lib/artefact";
import { listComparePairs, listProviderSlugs } from "@/lib/provider-pages";
import { canonical } from "@/lib/site";

// The sitemap is the crawl manifest of the *indexable* surface (ADR 0009): the
// static answer-first pages plus the curated etalage queries. It must NOT list
// the engine long-tail — those pages carry a noindex meta and indexing them
// would create the doorway/scaled-content pages ADR 0009 forbids. Every URL is
// derived from the registry via canonical(), so it can never drift.
const urls = sitemap().map((e) => e.url);

const STATIC_PAGES = ["/", "/categories", "/methodology", "/for-agents"];

describe("sitemap", () => {
  it("bevat de statische indexeerbare pagina's, elk op de site-origin", () => {
    for (const path of STATIC_PAGES) {
      expect(urls).toContain(canonical(path));
    }
  });

  it("bevat elke etalage-query, afgeleid uit de registry", () => {
    const etalage = listEtalage();
    expect(etalage.length).toBeGreaterThan(0);
    for (const { category, query } of etalage) {
      expect(urls).toContain(canonical(`/${category}/${query}`));
    }
  });

  it("bevat elke canonieke compare- en pricing-pagina, afgeleid uit de registry", () => {
    for (const { category, pair } of listComparePairs()) {
      expect(urls).toContain(canonical(`/compare/${category}/${pair}`));
    }
    for (const slug of listProviderSlugs()) {
      expect(urls).toContain(canonical(`/pricing/${slug}`));
    }
  });

  it("bevat uitsluitend indexeerbare URLs (statics + etalage + compare/pricing), géén engine long-tail", () => {
    // The ADR 0009 guardrail, as an invariant: anything in the sitemap is either
    // a static page or a registry-derived indexable page (etalage, compare,
    // pricing). A noindex long-tail URL slipping in would fail here.
    const allowed = new Set([
      ...STATIC_PAGES.map((p) => canonical(p)),
      ...listEtalage().map((e) => canonical(`/${e.category}/${e.query}`)),
      ...listComparePairs().map((p) => canonical(`/compare/${p.category}/${p.pair}`)),
      ...listProviderSlugs().map((s) => canonical(`/pricing/${s}`)),
    ]);
    for (const u of urls) {
      expect(allowed.has(u)).toBe(true);
    }
    expect(urls.length).toBe(allowed.size); // nothing dropped, nothing extra
  });
});
