import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page, * as pageModule from "@/app/compare/[category]/[pair]/page";
import { generateMetadata, generateStaticParams } from "@/app/compare/[category]/[pair]/page";
import { getComparison, listComparePairs } from "@/lib/provider-pages";

const CATEGORY = "transcription";
const PAIR = "assemblyai-vs-deepgram";

async function renderPage(category: string, pair: string): Promise<string> {
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ category, pair }) }));
}

// The compare page is a projection of the Categorie-ranking for two providers
// (same data, same honesty rules as the answer pages) — indexable, canonical,
// and statically generated for exactly the registry-derived pair inventory.
describe("compare-pagina", () => {
  it("genereert precies de canonieke paren; dynamicParams blijft AAN voor de 308", () => {
    expect(generateStaticParams()).toEqual(listComparePairs().map(({ category, pair }) => ({ category, pair })));
    // Regression: dynamicParams=false made the router 404 a reversed pair
    // BEFORE the page's permanentRedirect could run (live-verified). The
    // redirect requires unknown params to reach the page code.
    expect((pageModule as { dynamicParams?: boolean }).dynamicParams).toBeUndefined();
  });

  it("een niet-bestaand paar 404t in de paginacode (geen content onder crafted URLs)", async () => {
    await expect(renderPage(CATEGORY, "foo-vs-bar")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/);
  });

  it("rendert H1 met beide providers en de per-as waarden uit de ranking", async () => {
    const html = await renderPage(CATEGORY, PAIR);
    const cmp = getComparison(CATEGORY, PAIR)!;
    expect(html).toContain("AssemblyAI vs Deepgram");
    expect(html).toContain(cmp.a.naam);
    expect(html).toContain(cmp.b.naam);
    // The price verdict values (with unit text) survive into the table.
    const price = cmp.verdicts[0];
    expect(html).toContain(price.va);
    expect(html).toContain(price.vb);
    // Freshness + confidence stay visible, like every answer surface.
    expect(html).toContain(cmp.ranking.zekerheidslabel);
    expect(html).toContain(cmp.ranking.laatst_bijgewerkt);
    // Sources with dates — the herkomst rule applies here too (ADR 0003).
    expect(html).toContain(cmp.ranking.bronnen[0].titel);
  });

  it("redirect (308) van een omgekeerd paar naar de canonieke volgorde", async () => {
    await expect(renderPage(CATEGORY, "deepgram-vs-assemblyai")).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("metadata: title met beide namen, summary als description, canonical", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ category: CATEGORY, pair: PAIR }) });
    expect(meta.title).toContain("AssemblyAI vs Deepgram");
    expect(meta.description).toBe(getComparison(CATEGORY, PAIR)!.summary);
    expect(meta.alternates?.canonical).toBe(`/compare/${CATEGORY}/${PAIR}`);
  });
});
