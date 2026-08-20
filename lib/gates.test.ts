import { describe, it, expect } from "vitest";
import { checkRanking } from "@/lib/gates";
import { getRanking } from "@/lib/ranking";
import type { CategorieRanking } from "@/lib/types";

// Kwaliteitspoorten (ADR 0007/0008): deterministic checks that run before
// publication. A failed gate triggers the kill-switch (human-by-exception),
// never a content review. The quality floor lives in these gates, not in human
// attention. This is the LLM-free half of the recept-pijplijn (b).
function clone(r: CategorieRanking): CategorieRanking {
  return JSON.parse(JSON.stringify(r)) as CategorieRanking;
}

describe("checkRanking — kwaliteitspoorten", () => {
  it("de echte ranking passeert alle poorten", () => {
    const result = checkRanking(getRanking());
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("vlagt een aanbeveling die geen bestaand provider-aanbod noemt", () => {
    const r = clone(getRanking());
    const slug = Object.keys(r.queries)[0];
    r.queries[slug].recommendation.default = "Niet Bestaand Aanbod";
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.gate === "aanbeveling-verwijst-naar-bestaand-aanbod"),
    ).toBe(true);
  });

  it("vlagt een as-aanbeveling die naar een onbekend aanbod wijst", () => {
    const r = clone(getRanking());
    const slug = Object.keys(r.queries)[0];
    const as = Object.keys(r.queries[slug].recommendation.axes)[0];
    r.queries[slug].recommendation.axes[as] = "Spookaanbod";
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.gate === "aanbeveling-verwijst-naar-bestaand-aanbod"),
    ).toBe(true);
  });

  it("vlagt een provider zonder positieve prijs", () => {
    const r = clone(getRanking());
    r.providers[0].prijs.waarde = 0;
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.gate === "provider-velden-compleet")).toBe(true);
  });

  it("staat een onbekende prijs (null) toe als die niet vergelijkbaar is", () => {
    const r = clone(getRanking());
    // An explicitly non-comparable offering may have no clean per-unit price
    // (e.g. credit-priced) — an honest gap, like a null metric, not a failure.
    // It is already excluded from the cheapest axis by the price sentinel.
    r.providers[0].prijs.waarde = null as unknown as number;
    r.providers[0].prijs.vergelijkbaar = false;
    const result = checkRanking(r);
    expect(result.failures.some((f) => f.gate === "provider-velden-compleet")).toBe(false);
  });

  it("vlagt een ontbrekende prijs nog steeds als die WEL vergelijkbaar zou zijn", () => {
    const r = clone(getRanking());
    r.providers[0].prijs.waarde = null as unknown as number;
    r.providers[0].prijs.vergelijkbaar = true;
    const result = checkRanking(r);
    expect(result.failures.some((f) => f.gate === "provider-velden-compleet")).toBe(true);
  });

  it("vlagt een lege verplichte provider-tekst", () => {
    const r = clone(getRanking());
    r.providers[0].sterk = "   ";
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.gate === "provider-velden-compleet")).toBe(true);
  });

  it("vlagt een ongeldige ISO-datum", () => {
    const r = clone(getRanking());
    r.laatst_bijgewerkt = "19-06-2026";
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.gate === "geldige-datums")).toBe(true);
  });

  it("vlagt een misvormde bron-URL", () => {
    const r = clone(getRanking());
    r.bronnen[0].url = "niet-een-url";
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.gate === "bron-welgevormd")).toBe(true);
  });

  it("vlagt een as-metric met het verkeerde type (string waar getal hoort)", () => {
    const r = clone(getRanking());
    // "wer" backs a min-axis (numeric); a string value would make the computed
    // verdict silently wrong, so the generic as-velden gate must catch it.
    r.providers[0].metrics.wer = "laag";
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.gate === "as-velden")).toBe(true);
  });

  it("vlagt een provider die een door een as gebruikte metric mist", () => {
    const r = clone(getRanking());
    delete r.providers[0].metrics.wer;
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.gate === "as-velden")).toBe(true);
  });

  it("vlagt een lege ranking", () => {
    const r = clone(getRanking());
    r.providers = [];
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.gate === "niet-leeg")).toBe(true);
  });

  it("vlagt een hap die korter is dan 40 woorden", () => {
    const r = clone(getRanking());
    const slug = Object.keys(r.queries)[0];
    r.queries[slug].hap = "Too short to be a citeerbare hap.";
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.gate === "hap-lengte")).toBe(true);
  });

  it("vlagt een as-aanbeveling die afwijkt van de engine-berekende winnaar", () => {
    const r = clone(getRanking());
    const slug = Object.keys(r.queries)[0];
    // Point the accuracy axis at a real-but-wrong offering: the engine computes
    // the most-accurate winner from WER, so naming anyone else is fakery.
    r.queries[slug].recommendation.axes["hoogste-nauwkeurigheid"] =
      "AssemblyAI Universal-3 Pro";
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.gate === "aanbeveling-consistent-met-engine")).toBe(true);
  });

  it("vlagt twee queries met near-duplicate haps", () => {
    const r = clone(getRanking());
    const slug = Object.keys(r.queries)[0];
    const original = r.queries[slug];
    // A near-copy hap (one word swapped) is exactly the thin doorway-content
    // ADR 0009 forbids — each published query needs a substantially unique hap.
    r.queries["best-transcription-api-for-german"] = {
      query: "Best transcription API for German",
      hap: original.hap.replace("Dutch", "German"),
      recommendation: original.recommendation,
    };
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.gate === "hap-uniek")).toBe(true);
  });

  it("vlagt een hap die een prijs noemt die niet in de provider-tabel staat", () => {
    const r = clone(getRanking());
    const slug = "best-speech-to-text-transcription-api-2026";
    // The hap quotes "$3.50/1000 min" — a computed price. Drift it to a figure
    // no provider charges: the citeerbare kern now lies, which no other gate
    // catches (aanbeveling-consistent only checks the recommendation fields,
    // not the prose).
    r.queries[slug].hap = r.queries[slug].hap.replace("$3.50", "$9.99");
    const result = checkRanking(r);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.gate === "hap-cijfers-gedekt")).toBe(true);
  });

  it("vlagt een hap die een WER-percentage noemt dat niet in de tabel staat", () => {
    const r = clone(getRanking());
    const slug = "best-speech-to-text-transcription-api-2026";
    // "2.2% WER" is the leaderboard figure; 1.1% matches no provider's wer.
    r.queries[slug].hap = r.queries[slug].hap.replace("2.2% WER", "1.1% WER");
    const result = checkRanking(r);
    expect(result.failures.some((f) => f.gate === "hap-cijfers-gedekt")).toBe(true);
  });

  it("vlagt een hap die een latency (ms) noemt die niet in de tabel staat", () => {
    const r = clone(getRanking());
    const slug = "lowest-latency-real-time-streaming-transcription-api";
    r.queries[slug].hap = r.queries[slug].hap.replace("150 ms", "999 ms");
    const result = checkRanking(r);
    expect(result.failures.some((f) => f.gate === "hap-cijfers-gedekt")).toBe(true);
  });

  it("laat eenheid-loze getallen (jaartal, aantal talen) ongemoeid", () => {
    // The real haps cite "2026", "99 languages", "~70" — bare counts with no
    // $/%/ms marker. They must NOT trip the gate, or it would false-positive on
    // every prose number. Matching is unit-anchored, not every-number.
    const result = checkRanking(getRanking());
    expect(result.failures.some((f) => f.gate === "hap-cijfers-gedekt")).toBe(false);
  });

  it("controleert het bedrag ná $, niet het noemer-getal van de prijs-eenheid", () => {
    const r = clone(getRanking());
    const slug = "best-speech-to-text-transcription-api-2026";
    // "$3.50/1000 min": the 1000 is part of the unit, not a data-claim. Changing
    // only the denominator leaves the gate silent; just the amount after $ is
    // validated.
    r.queries[slug].hap = r.queries[slug].hap.replace("$3.50/1000 min", "$3.50/2000 min");
    const result = checkRanking(r);
    expect(result.failures.some((f) => f.gate === "hap-cijfers-gedekt")).toBe(false);
  });
});
