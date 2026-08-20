import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page, { dynamicParams, generateMetadata, generateStaticParams } from "@/app/pricing/[provider]/page";
import { getProviderPricing, listProviderSlugs } from "@/lib/provider-pages";

async function renderPage(provider: string): Promise<string> {
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ provider }) }));
}

// The pricing page: one provider's offerings across categories, prices with
// their dated sources, honest nulls, and an interlink to the cheapest
// in-category alternative's compare page.
describe("pricing-pagina", () => {
  it("genereert precies de registry-afgeleide provider-slugs, niets dynamisch", () => {
    expect(generateStaticParams()).toEqual(listProviderSlugs().map((provider) => ({ provider })));
    expect(dynamicParams).toBe(false);
  });

  it("rendert alle offerings van een multi-categorie provider met prijzen", async () => {
    const html = await renderPage("google");
    const pricing = getProviderPricing("google")!;
    expect(html).toContain("Google API pricing");
    for (const o of pricing.offerings) {
      expect(html).toContain(o.aanbod.naam);
      expect(html).toContain(o.categoryLabel);
    }
  });

  it("een null-prijs blijft een eerlijk gat, geen verzonnen getal", async () => {
    const html = await renderPage("speechmatics");
    expect(html).toContain("No published per-unit price");
  });

  it("verwijst naar de compare-pagina van het goedkoopste alternatief", async () => {
    const pricing = getProviderPricing("deepgram")!;
    const stt = pricing.offerings.find((o) => o.category === "transcription")!;
    const html = await renderPage("deepgram");
    expect(html).toContain(`/compare/transcription/${stt.cheapestAlt!.pair}`);
  });

  it("metadata: title, computed description en canonical", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ provider: "deepgram" }) });
    expect(meta.title).toContain("Deepgram API pricing");
    expect(meta.description).toBeTruthy();
    expect(meta.alternates?.canonical).toBe("/pricing/deepgram");
  });
});
