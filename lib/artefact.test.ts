import { describe, it, expect } from "vitest";
import { getArtefact, getArtefactByQuery, resolveBySlug } from "@/lib/artefact";

// The Antwoord-artefact is the atomic delivery unit: one answer to one query
// (ADR 0002). MVP-1 aggregates only, so every artefact is a "light
// estimate" (ADR 0001) — never presented as "hard tested".
describe("getArtefact", () => {
  it("levert het antwoord-artefact voor de transcriptie-query, gelabeld als light estimate", () => {
    const artefact = getArtefact("transcription", "best-transcription-api-for-dutch");

    expect(artefact).not.toBeNull();
    expect(artefact?.hap.length).toBeGreaterThan(0);
    expect(artefact?.zekerheidslabel).toBe("light estimate");
  });
});

// FIX 1: the endpoint path must route via matchCategory, not the silent
// transcription fallback. An in-scope natural-language query lands in its true
// category; an out-of-scope / gibberish query gets an honest no-match artefact.
describe("getArtefactByQuery — honest routing (FIX 1)", () => {
  it("routes a natural-language web-search intent to web-search, not transcription", () => {
    const a = getArtefactByQuery(
      "I'm building an AI agent and need it to look things up on the internet",
    )!;
    expect(a.category).toBe("web-search");
    expect(a.routing).toBe("matched");
  });

  it("returns a no-match artefact (not a transcription answer) for an out-of-scope query", () => {
    const a = getArtefactByQuery("best image generation API")!;
    expect(a.routing).toBe("none");
    expect(a.category).not.toBe("transcription");
    // it carries the supported catalogue so the agent can re-ask in scope
    expect(a.categories?.map((c) => c.category)).toContain("transcription");
    expect(a.categories).toHaveLength(5);
    // no fabricated providers / recommendation
    expect(a.providers).toHaveLength(0);
    expect(a.recommendation.axes).toEqual({});
  });

  it("returns a no-match artefact for gibberish", () => {
    const a = getArtefactByQuery("asdfqwer zxcv")!;
    expect(a.routing).toBe("none");
  });

  it("an explicit category still wins over detection", () => {
    const a = getArtefactByQuery("best image generation API", "transcription")!;
    expect(a.category).toBe("transcription");
    expect(a.routing).toBe("matched");
  });

  it("returns null only for an empty query", () => {
    expect(getArtefactByQuery("")).toBeNull();
    expect(getArtefactByQuery("   ")).toBeNull();
  });
});

// Paraphrase match: agents rarely repeat a published query verbatim ("…for IVR
// phone system" vs the published "…for IVR and phone agents"), and the old
// slug-exact-or-engine flow served them the generic category default instead of
// the curated etalage answer. A query whose distinctive words point clearly at
// ONE published entry now gets that entry; ambiguity falls through to the engine.
describe("getArtefactByQuery — published-entry paraphrase match", () => {
  it("serves the curated IVR artefact for an IVR paraphrase", () => {
    const a = getArtefactByQuery("best text-to-speech API for IVR phone system")!;
    expect(a.query).toBe("Best text-to-speech API for IVR and phone agents");
    expect(a.recommendation.default).toBe("Deepgram Aura-2");
  });

  it("serves the curated podcast artefact for a podcast paraphrase", () => {
    const a = getArtefactByQuery("best transcription API for podcast audio")!;
    expect(a.query).toBe("Best transcription API for podcasts");
  });

  it("a generic category question still gets the engine answer, not a guessed etalage page", () => {
    const a = getArtefactByQuery("best transcription API")!;
    expect(a.query).toBe("best transcription API");
  });

  it("a paraphrase hitting two entries equally falls through to the engine", () => {
    const a = getArtefactByQuery("best transcription API for Dutch podcasts")!;
    expect(a.query).toBe("best transcription API for Dutch podcasts");
  });
});

// The long-tail gate: /[category]/[slug] URLs are attacker-writable strings, so a
// live engine answer is only served when the de-slugged question shows a real
// signal for that category — an axis keyword (cheapest, most accurate, …) or a
// category keyword (transcribe, …). Without any signal the page must 404 instead
// of rendering a confident "Default pick" under Syftly branding for an arbitrary
// URL (e.g. /transcription/syftly-recommends-scam-api).
describe("resolveBySlug — long-tail gate", () => {
  it("serves the published etalage artefact, flagged etalage:true", () => {
    const r = resolveBySlug("transcription", "best-transcription-api-for-dutch");
    expect(r.artefact).not.toBeNull();
    expect(r.etalage).toBe(true);
  });

  it("answers an unpublished slug that carries an axis keyword (engine, noindex)", () => {
    const r = resolveBySlug("transcription", "cheapest-transcription-api");
    expect(r.artefact).not.toBeNull();
    expect(r.etalage).toBe(false);
  });

  it("answers an unpublished slug that carries a category keyword", () => {
    const r = resolveBySlug("transcription", "how-do-i-transcribe-podcasts");
    expect(r.artefact).not.toBeNull();
    expect(r.etalage).toBe(false);
  });

  it("refuses a slug with no in-category signal at all", () => {
    const r = resolveBySlug("transcription", "what-is-the-weather-today-xyz");
    expect(r.artefact).toBeNull();
  });

  it("refuses a spoofed marketing/scam slug", () => {
    const r = resolveBySlug("transcription", "syftly-recommends-you-buy-bitcoin-now");
    expect(r.artefact).toBeNull();
  });

  it("still returns null for an unknown category", () => {
    const r = resolveBySlug("image-generation", "cheapest-image-api");
    expect(r.artefact).toBeNull();
  });
});
