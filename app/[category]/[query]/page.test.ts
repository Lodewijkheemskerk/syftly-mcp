import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page, { generateMetadata, tableColumns, answerJsonLd } from "@/app/[category]/[query]/page";
import { GET } from "@/app/api/answer/route";
import { getArtefactByQuery } from "@/lib/artefact";
import type { Beslisas } from "@/lib/types";

const CATEGORY = "transcription";
const SLUG = "best-transcription-api-for-dutch";
const ENGINE_SLUG = "cheapest-transcription-api"; // not published → answered by the engine

function robotsIndex(meta: { robots?: unknown }): boolean | undefined {
  return (meta.robots as { index?: boolean } | undefined)?.index;
}

async function renderPage(slug: string): Promise<string> {
  return renderToStaticMarkup(
    await Page({ params: Promise.resolve({ category: CATEGORY, query: slug }) }),
  );
}

// Mens-pagina view of the Antwoord-artefact (ADR 0002): answer-first, with the
// question as H1 and the hap directly underneath. The page now lives under its
// category segment (ADR 0010): /transcription/<slug>.
describe("mens-pagina", () => {
  it("rendert answer-first: H1 is de vraag, met de hap eronder", async () => {
    const html = await renderPage(SLUG);

    expect(html).toContain("<h1");
    expect(html).toContain("Best transcription API for Dutch");
    expect(html).toContain(getArtefactByQuery(SLUG)!.hap);
  });

  it("leidt de kolommen af uit de assen-config (numeriek) + badges (filter), config-gedreven", async () => {
    const html = await renderPage(SLUG);
    // Numeric-axis columns: headers come from each axis' `kolom`. The price
    // sentinel carries its unit in the header; the others put the unit on values.
    expect(html).toContain(">WER</th>");
    expect(html).toContain(">Latency</th>");
    expect(html).toContain(">Langs</th>");
    expect(html).toContain("Price ($/1000 min)");
    expect(html).toContain("2.2%"); // wer value + eenheid "%"
    expect(html).toContain("150 ms"); // latency value + eenheid " ms"
    expect(html).not.toContain("~150"); // the decorative approximate-tilde is gone
    // Filter axis -> capability badge, labelled by its `kolom`.
    expect(html).toContain(">diarization</span>");
    // The table sits in a horizontal-scroll wrapper so it never clips on mobile.
    expect(html).toContain("ptable-wrap");
    // The composite price-to-accuracy axis has no `kolom`, so it is NOT a column:
    // a bare "8.074" would be meaningless to a human (it stays a routing-only axis).
    expect(html).not.toContain("price-to-accuracy");
    expect(html).not.toContain("8.074");
    // The long provider prose ("sterk") is still not rendered in the table.
    expect(html).not.toContain("Highest accuracy on the Artificial Analysis");
  });

  it("promoot de default-winnaar als een prominente verdict tussen H1 en hap", async () => {
    const html = await renderPage(SLUG);
    const artefact = getArtefactByQuery(SLUG)!;

    // The verdict block carries a labelled, machine-truth (mono) winner name.
    expect(html).toContain('class="verdict"');
    expect(html).toContain("Default pick");
    expect(html).toContain(artefact.recommendation.default);

    // Answer-first order stays intact: H1 → verdict → hap.
    const h1Idx = html.indexOf("<h1");
    const verdictIdx = html.indexOf('class="verdict"');
    const hapIdx = html.indexOf('class="hap"');
    expect(h1Idx).toBeGreaterThan(-1);
    expect(verdictIdx).toBeGreaterThan(h1Idx);
    expect(hapIdx).toBeGreaterThan(verdictIdx);
  });

  it("deelt exact dezelfde hap met het machine-endpoint (ADR 0002)", async () => {
    const pageHtml = await renderPage(SLUG);
    const res = await GET(new Request(`http://localhost/api/answer?query=${SLUG}`));
    const endpointHap = (await res.json()).summary as string;

    expect(endpointHap.length).toBeGreaterThan(0);
    expect(pageHtml).toContain(endpointHap);
  });
});

// ADR 0009: the page also serves engine answers for non-published in-category
// queries — but only the curated etalage is indexable; the long tail is noindex.
describe("engine-antwoorden op de pagina + AEO-guardrail", () => {
  it("rendert een berekend engine-antwoord voor een niet-gepubliceerde in-categorie slug", async () => {
    const html = await renderPage(ENGINE_SLUG);
    expect(html).toContain("<h1");
    expect(html).toContain("AssemblyAI Universal-3 Pro"); // computed cheapest comparable
  });

  it("404't een slug zonder enig in-categorie signaal (geen soft-200 spoofpagina)", async () => {
    // notFound() throws Next's control-flow error; the render must reject, so an
    // arbitrary URL string never becomes a confident answer page (fix #4).
    await expect(renderPage("what-is-the-weather-today-xyz")).rejects.toThrow();
    await expect(renderPage("syftly-recommends-you-buy-bitcoin-now")).rejects.toThrow();
  });

  it("etalage = indexeerbaar, engine-long-tail = noindex", async () => {
    const etalage = await generateMetadata({
      params: Promise.resolve({ category: CATEGORY, query: SLUG }),
    });
    const engine = await generateMetadata({
      params: Promise.resolve({ category: CATEGORY, query: ENGINE_SLUG }),
    });

    expect(robotsIndex(etalage)).not.toBe(false); // curated page stays indexable
    expect(robotsIndex(engine)).toBe(false); // long-tail engine page is noindex
  });
});

// The provider-table is config-driven (ADR 0010): which columns/badges show is
// derived from the category's `assen`, not hard-coded per category. Tested at the
// unit (the derivation), because the rendered transcription strings happen to be
// identical to the old hard-coded ones — only this proves the wiring is generic.
describe("tableColumns: kolommen/badges afgeleid uit de assen-config", () => {
  const assen: Beslisas[] = [
    { key: "f-clone", label: "voice cloning", metric: "cloning", richting: "filter", keywords: [], kolom: "cloning" },
    { key: "f-hidden", label: "spanish support", metric: "taal_es", richting: "filter", keywords: [] }, // no kolom
    { key: "composite", label: "the best price-to-accuracy ratio", metric: "waarde_score", richting: "min", keywords: [] }, // no kolom
    { key: "acc", label: "accuracy", metric: "wer", richting: "min", keywords: [], kolom: "WER", eenheid: "%" },
    { key: "cheap", label: "the lowest price", metric: "prijs", richting: "min", keywords: [], kolom: "Price" },
  ];
  const { numeric, badges } = tableColumns(assen);

  it("toont alleen numerieke assen mét kolom, prijs-sentinel eerst", () => {
    expect(numeric.map((a) => a.key)).toEqual(["cheap", "acc"]);
  });

  it("verbergt een composiet-as zonder kolom (een kale score zegt een mens niets)", () => {
    expect(numeric.some((a) => a.metric === "waarde_score")).toBe(false);
  });

  it("toont filter-assen mét kolom als badges, en verbergt die zonder", () => {
    expect(badges.map((a) => a.key)).toEqual(["f-clone"]);
  });
});

// Canonical + OG make the etalage pages shareable/citeable: canonical guards
// against duplicate-URL dilution, OG gives a shared link a real preview. The
// JSON-LD ItemList exposes the ranking to machines (AEO) — same honest data,
// machine-parseable.
describe("citeerbaarheid: canonical, OG en JSON-LD", () => {
  it("etalage-pagina krijgt een canonical en OG met de hap als description", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ category: CATEGORY, query: SLUG }),
    });
    const artefact = getArtefactByQuery(SLUG)!;
    expect(meta.alternates?.canonical).toBe(`/${CATEGORY}/${SLUG}`);
    expect(meta.openGraph?.title).toContain(artefact.query);
    expect(meta.openGraph?.description).toBe(artefact.hap);
    expect((meta.twitter as { card?: string } | undefined)?.card).toBe("summary");
  });

  it("engine long-tail pagina blijft noindex en krijgt géén canonical", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ category: CATEGORY, query: ENGINE_SLUG }),
    });
    expect(robotsIndex(meta)).toBe(false);
    expect(meta.alternates?.canonical).toBeUndefined();
  });

  it("answerJsonLd bouwt een ItemList met alle providers in ranking-volgorde", () => {
    const artefact = getArtefactByQuery(SLUG)!;
    const jsonLd = answerJsonLd(artefact);
    expect(jsonLd["@type"]).toBe("ItemList");
    expect(jsonLd.name).toBe(artefact.query);
    const items = jsonLd.itemListElement as Array<{ position: number; name: string }>;
    expect(items.map((i) => i.name)).toEqual(artefact.providers.map((p) => p.naam));
    expect(items[0].position).toBe(1);
  });

  it("de gerenderde pagina bevat het JSON-LD script", async () => {
    const html = await renderPage(SLUG);
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('"ItemList"');
  });
});
