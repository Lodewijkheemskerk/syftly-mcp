import { describe, expect, it } from "vitest";
import {
  canonicalPair,
  getComparison,
  getProviderPricing,
  listComparePairs,
  listProviderSlugs,
  providerDisplay,
  providerSlug,
} from "@/lib/provider-pages";
import { listCategories } from "@/lib/categories";

// The compare/pricing pages are projections of the same Categorie-rankings the
// answer pages render (ADR 0002/0009): every number on them is a ranking value,
// winners are computed with the engine's semantics, and the page inventory is
// registry-derived so it can never drift from the data.

describe("providerSlug / providerDisplay", () => {
  it("slugs the company name, dropping parentheticals and legal suffixes", () => {
    expect(providerSlug("Deepgram")).toBe("deepgram");
    expect(providerSlug("Brave Software")).toBe("brave-software");
    expect(providerSlug("Tavily (acquired by Nebius, Feb 2026)")).toBe("tavily");
    expect(providerSlug("SerpApi LLC")).toBe("serpapi");
    expect(providerSlug("Z.ai (Zhipu AI)")).toBe("z-ai");
  });

  it("display keeps casing but drops the parenthetical/suffix noise", () => {
    expect(providerDisplay("Tavily (acquired by Nebius, Feb 2026)")).toBe("Tavily");
    expect(providerDisplay("SerpApi LLC")).toBe("SerpApi");
    expect(providerDisplay("Deepgram")).toBe("Deepgram");
  });
});

describe("listComparePairs", () => {
  const pairs = listComparePairs();

  it("covers every in-category provider pair exactly once, in ranking order", () => {
    for (const ranking of listCategories()) {
      const slugs = ranking.providers.map((p) => providerSlug(p.provider));
      const unique = [...new Set(slugs)];
      const expected = (unique.length * (unique.length - 1)) / 2;
      const inCategory = pairs.filter((p) => p.category === ranking.category);
      expect(inCategory.length).toBe(expected);
      // Canonical direction: the higher-ranked provider comes first.
      for (const { pair } of inCategory) {
        const [a, b] = pair.split("-vs-");
        expect(unique.indexOf(a)).toBeLessThan(unique.indexOf(b));
      }
    }
  });

  it("contains the classic searched pair", () => {
    expect(pairs).toContainEqual({ category: "transcription", pair: "assemblyai-vs-deepgram" });
  });
});

describe("getComparison", () => {
  const cmp = getComparison("transcription", "assemblyai-vs-deepgram")!;

  it("resolves both sides from the ranking", () => {
    expect(cmp.a.provider).toBe("AssemblyAI");
    expect(cmp.b.provider).toBe("Deepgram");
    expect(cmp.ranking.category).toBe("transcription");
  });

  it("computes the price verdict with engine semantics (lower comparable price wins)", () => {
    const price = cmp.verdicts.find((v) => v.axis.metric === "prijs")!;
    expect(price.va).toContain("3.5");
    expect(price.vb).toContain("4.3");
    expect(price.winner).toBe("a");
  });

  it("never fabricates a winner when a side has no number", () => {
    for (const v of cmp.verdicts) {
      if (v.va === "—" || v.vb === "—") expect(v.winner).toBeNull();
    }
  });

  it("summary names both offerings and only computed values", () => {
    expect(cmp.summary).toContain("AssemblyAI Universal-3 Pro");
    expect(cmp.summary).toContain("Deepgram Nova-3");
  });

  it("returns null for unknown categories, unknown providers and self-compares", () => {
    expect(getComparison("nope", "assemblyai-vs-deepgram")).toBeNull();
    expect(getComparison("transcription", "assemblyai-vs-unknowncorp")).toBeNull();
    expect(getComparison("transcription", "deepgram-vs-deepgram")).toBeNull();
  });

  it("reversed slug is not served but resolves to its canonical for a redirect", () => {
    expect(getComparison("transcription", "deepgram-vs-assemblyai")).toBeNull();
    expect(canonicalPair("transcription", "deepgram-vs-assemblyai")).toBe(
      "assemblyai-vs-deepgram",
    );
    expect(canonicalPair("transcription", "assemblyai-vs-deepgram")).toBeNull();
    expect(canonicalPair("transcription", "foo-vs-bar")).toBeNull();
  });
});

describe("getProviderPricing", () => {
  it("collects a provider's offerings across categories (Google: STT + TTS)", () => {
    const google = getProviderPricing("google")!;
    expect(google.provider).toBe("Google");
    const cats = google.offerings.map((o) => o.category);
    expect(cats).toContain("transcription");
    expect(cats).toContain("tts");
  });

  it("keeps 'Google Cloud' a separate provider page", () => {
    const gc = getProviderPricing("google-cloud")!;
    expect(gc.offerings.map((o) => o.category)).toEqual(["ocr"]);
  });

  it("links the cheapest in-category alternative with its canonical compare pair", () => {
    const deepgram = getProviderPricing("deepgram")!;
    const stt = deepgram.offerings.find((o) => o.category === "transcription")!;
    // Transcription's cheapest comparable offer is not Deepgram's, so the
    // alternative exists and the pair slug round-trips into getComparison.
    expect(stt.cheapestAlt).not.toBeNull();
    expect(getComparison("transcription", stt.cheapestAlt!.pair)).not.toBeNull();
  });

  it("preserves honest null prices instead of inventing a number", () => {
    const sm = getProviderPricing("speechmatics")!;
    expect(sm.offerings[0].aanbod.prijs.waarde).toBeNull();
  });

  it("lists every provider slug exactly once", () => {
    const slugs = listProviderSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain("deepgram");
    expect(slugs).toContain("google-cloud");
    expect(getProviderPricing("not-a-provider")).toBeNull();
  });
});
