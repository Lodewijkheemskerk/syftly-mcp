import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page, { categoryCards } from "@/app/categories/page";
import { listCategories } from "@/lib/categories";
import type { CategorieRanking } from "@/lib/types";

// The Categories page lists every REGISTERED category (ADR 0010 registry), one
// card each, pinned to real ranking figures so it can't drift into a fake
// "coming soon" grid (ADR 0009: depth is real aggregation, not a padded list).
function render(): string {
  return renderToStaticMarkup(Page());
}

describe("Categories page", () => {
  const html = render();

  it("rendert een kaart per geregistreerde categorie met zijn echte cijfers", () => {
    for (const r of listCategories()) {
      // Labels render as HTML, so "&" comes out as the entity "&amp;".
      const labelHtml = r.label.replace(/&/g, "&amp;");
      expect(html).toContain(labelHtml); // e.g. "Transcription" / "Scraping &amp; browser"
      expect(html).toContain(String(r.providers.length)); // offerings count, from data
      expect(html).toContain(`/${r.category}/`); // links into its own category segment
    }
  });

  it("labels the confidence honestly", () => {
    expect(html).toContain("light estimate");
  });

  it("does NOT fake a grid of unbuilt categories", () => {
    expect(html.toLowerCase()).not.toContain("coming soon");
  });
});

// The card list is registry-driven, proven at the unit: with one registered
// category the rendered strings still match the old hard-coded card, so only
// feeding multiple rankings shows the loop actually iterates the registry.
describe("categoryCards: één kaart-viewmodel per ranking", () => {
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

  const cards = categoryCards([fakeRanking("alpha", "q-a", 2), fakeRanking("beta", "q-b", 3)]);

  it("itereert de hele registry, in volgorde", () => {
    expect(cards.map((c) => c.category)).toEqual(["alpha", "beta"]);
  });

  it("leidt de cijfers per ranking af (offerings, cheapest, href)", () => {
    expect(cards[0].offerings).toBe(2);
    expect(cards[1].offerings).toBe(3);
    expect(cards[0].queries).toBe(1);
    expect(cards[0].etalageHref).toBe("/alpha/q-a");
    expect(cards[1].cheapest).toBe("beta-offer-0"); // lowest comparable price
  });
});
