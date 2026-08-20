import { describe, it, expect } from "vitest";
import { getRanking } from "@/lib/ranking";
import { cheapest, answerQuery } from "@/lib/engine";
import { slugify } from "@/lib/slug";
import type { CategorieRanking } from "@/lib/types";

// The query-engine (ADR 0009): a free in-category question becomes an answer by
// mapping it to a beslis-as whose winner is COMPUTED from the ranking — not a
// per-query hand-authored verdict. Multiple axes; LLM-free.
const ranking = getRanking();
const def = (q: string) => answerQuery(ranking, q)!.recommendation.default;
const axisKeys = (q: string) => Object.keys(answerQuery(ranking, q)!.recommendation.axes);

describe("cheapest (computed, excludes non-comparable token pricing)", () => {
  it("returns the lowest directly-comparable price, NOT the cheaper token-priced Gemini", () => {
    const winner = cheapest(ranking)!;
    expect(winner.naam).toBe("AssemblyAI Universal-3 Pro"); // 3.50, lowest comparable
    // Gemini is literally cheaper (1.92) but marked vergelijkbaar:false → excluded.
    const gemini = ranking.providers.find((p) => p.provider === "Google")!;
    expect(gemini.prijs.waarde!).toBeLessThan(winner.prijs.waarde!);
    expect(gemini.prijs.vergelijkbaar).toBe(false);
  });
});

describe("answerQuery — axes", () => {
  it("cheapest → cheapest comparable", () => {
    expect(def("cheapest transcription API")).toBe("AssemblyAI Universal-3 Pro");
    expect(axisKeys("cheapest transcription API")).toEqual(["goedkoopste"]);
  });

  it("most accurate → lowest WER", () => {
    expect(def("most accurate transcription API")).toBe("ElevenLabs Scribe v2"); // 2.2% WER
    expect(axisKeys("most accurate transcription API")).toEqual(["hoogste-nauwkeurigheid"]);
  });

  it("multilingual → most languages by count", () => {
    expect(def("best multilingual transcription API")).toBe("AssemblyAI Universal-3 Pro"); // 99
    expect(axisKeys("best multilingual transcription API")).toEqual(["sterkste-meertalig"]);
  });

  it("lowest latency → lowest published latency_ms", () => {
    const a = answerQuery(ranking, "lowest-latency real-time transcription API")!;
    expect(a.recommendation.default).toBe("ElevenLabs Scribe v2"); // 150 ms, earliest of the tie
    expect(a.hap).toContain("not strictly comparable"); // honest latency caveat
  });

  it("price-to-accuracy → best value, and beats a bare 'cheapest' match (order matters)", () => {
    expect(def("best price-to-accuracy transcription API")).toBe("ElevenLabs Scribe v2");
    // "cheapest WITH good accuracy" must resolve to value, not cheapest. With FIX
    // 2 the engine no longer DROPS the bare price/accuracy axes it also matched —
    // it surfaces all three computed winners — but because the value (composite)
    // axis was named, its balance winner is the headline default (the honest
    // single answer), not the cheapest provider.
    expect(def("cheapest transcription API with good accuracy")).toBe("ElevenLabs Scribe v2"); // value winner
    expect(axisKeys("cheapest transcription API with good accuracy").sort()).toEqual([
      "beste-prijs-kwaliteit",
      "goedkoopste",
      "hoogste-nauwkeurigheid",
    ]);
  });

  it("capability queries filter to providers that support the trait", () => {
    expect(axisKeys("transcription API with speaker diarization")).toEqual(["met-diarisatie"]);
    expect(axisKeys("transcription with word-level timestamps")).toEqual(["met-timestamps"]);
    expect(axisKeys("transcription API with custom vocabulary")).toEqual(["met-custom-vocabulary"]);
    // OpenAI/Gemini lack these natively, so the winner is a dedicated API, not them.
    expect(["OpenAI gpt-4o-transcribe", "Google Gemini 3 Flash"]).not.toContain(
      def("transcription API with speaker diarization"),
    );
  });

  it("language queries pick the most accurate provider supporting that language", () => {
    expect(axisKeys("which API is best for Dutch audio")).toEqual(["voor-taal-nl"]);
    expect(axisKeys("best API for Spanish meetings")).toEqual(["voor-taal-es"]);
  });

  it("falls back to providers[0] when no axis matches — never 404", () => {
    const a = answerQuery(ranking, "transcribe my podcast")!;
    expect(a.recommendation.default).toBe(ranking.providers[0].naam);
    expect(Object.keys(a.recommendation.axes)).toHaveLength(0);
  });

  it("returns null for an empty question", () => {
    expect(answerQuery(ranking, "")).toBeNull();
    expect(answerQuery(ranking, "   ")).toBeNull();
  });

  it("renders a full artefact: light estimate, same providers/bronnen as the ranking", () => {
    const a = answerQuery(ranking, "cheapest transcription API")!;
    expect(a.zekerheidslabel).toBe("light estimate");
    expect(a.providers).toEqual(ranking.providers);
    expect(a.bronnen).toEqual(ranking.bronnen);
    expect(a.slug).toBe(slugify("cheapest transcription API"));
  });
});

// Bevinding ①: compound queries must COMPOSE. A query that names both a filter
// (e.g. a language) and an ordering axis (e.g. "cheapest") used to let the first
// axis in config order win outright — so "cheapest ... for Dutch" returned the
// first Dutch-supporting provider and silently ignored "cheapest". The engine
// now applies the filter axes as AND-constraints on the pool and computes the
// ordering axis WITHIN that pool, so both dimensions are honoured.
describe("answerQuery — compound queries compose filters with an ordering axis (Bevinding ①)", () => {
  it("cheapest + Dutch → cheapest comparable provider that supports Dutch", () => {
    expect(def("cheapest transcription API for Dutch")).toBe("AssemblyAI Universal-3 Pro");
  });

  it("records both axes — the language filter and the price ordering — naming the composed winner", () => {
    const a = answerQuery(ranking, "cheapest transcription API for Dutch")!;
    expect(a.recommendation.axes["goedkoopste"]).toBe("AssemblyAI Universal-3 Pro");
    expect(a.recommendation.axes["voor-taal-nl"]).toBe("AssemblyAI Universal-3 Pro");
    expect(Object.keys(a.recommendation.axes).sort()).toEqual(["goedkoopste", "voor-taal-nl"]);
  });

  it("the hap names both price and Dutch, not a bare 'top-ranked option that supports it'", () => {
    const hap = answerQuery(ranking, "cheapest transcription API for Dutch")!.hap;
    expect(hap).toMatch(/price/i);
    expect(hap).toMatch(/dutch/i);
    expect(hap).not.toContain("top-ranked option that supports it");
  });

  it("degrades safely when a filter excludes every provider (never 404, no crash)", () => {
    const noneSupport: CategorieRanking = {
      category: "demo",
      label: "Demo",
      zekerheidslabel: "light estimate",
      laatst_bijgewerkt: "2026-06-22",
      assen: [
        { key: "met-x", label: "feature X", metric: "x", richting: "filter", keywords: ["with x"] },
        { key: "goedkoopste", label: "the lowest price", metric: "prijs", richting: "min", keywords: ["cheapest"] },
      ],
      providers: [
        { naam: "Alpha", provider: "A", prijs: { waarde: 10, eenheid: "$/1k", vergelijkbaar: true }, metrics: { x: false }, sterk: "s", zwak: "w", bron: "b", bron_datum: "2026-06-22" },
        { naam: "Beta", provider: "B", prijs: { waarde: 5, eenheid: "$/1k", vergelijkbaar: true }, metrics: { x: false }, sterk: "s", zwak: "w", bron: "b", bron_datum: "2026-06-22" },
      ],
      bronnen: [{ titel: "t", url: "https://x.test", datum: "2026-06-22" }],
      queries: {},
    };
    const a = answerQuery(noneSupport, "cheapest with x")!;
    expect(a.recommendation.default).toBe("Alpha"); // degrades to providers[0]
    expect(Object.keys(a.recommendation.axes)).toHaveLength(0);
  });
});

// FIX 2 (Bevinding ②): a compound query that names 2+ ORDERING axes must keep
// every ordering axis — the engine used to keep only the first in config order
// and silently drop the rest, so "cheapest AND most accurate" answered only
// accuracy. Now every matched ordering axis is computed and surfaced.
describe("answerQuery — compound ordering axes are never dropped (Bevinding ②)", () => {
  it("'most accurate and cheapest' surfaces BOTH the price and accuracy axes", () => {
    const a = answerQuery(ranking, "most accurate and cheapest transcription API")!;
    const keys = Object.keys(a.recommendation.axes);
    expect(keys).toContain("goedkoopste"); // price NOT dropped
    expect(keys).toContain("hoogste-nauwkeurigheid"); // accuracy kept
    // each axis names its OWN computed winner, not one survivor for both
    expect(a.recommendation.axes["goedkoopste"]).toBe("AssemblyAI Universal-3 Pro"); // cheapest comparable
    expect(a.recommendation.axes["hoogste-nauwkeurigheid"]).toBe("ElevenLabs Scribe v2"); // lowest WER
  });

  it("the price+accuracy pair uses the composite value axis as the headline default", () => {
    // The category carries a beste-prijs-kwaliteit (waarde_score) composite, so a
    // price+accuracy pair resolves the single default to the value winner.
    const a = answerQuery(ranking, "most accurate and cheapest transcription API")!;
    expect(a.recommendation.default).toBe("ElevenLabs Scribe v2"); // best price-to-accuracy
  });

  it("the hap states the trade-off, naming each axis and its winner — never reframed to one axis", () => {
    const hap = answerQuery(ranking, "most accurate and cheapest transcription API")!.hap;
    expect(hap).toMatch(/price/i); // the price axis is named
    expect(hap).toMatch(/accuracy|accurate/i); // the accuracy axis is named
    expect(hap).toContain("AssemblyAI Universal-3 Pro"); // price winner
    expect(hap).toContain("ElevenLabs Scribe v2"); // accuracy winner
    expect(hap).toMatch(/different winners/i); // explicitly framed as a trade-off, not one axis
  });

  it("word order chooses the PRIMARY axis: 'cheapest most accurate' makes price primary", () => {
    // Two conflicting ordering axes with no composite tiebreak in this synthetic
    // category: the axis whose keyword appears EARLIEST in the query wins default.
    const demo: CategorieRanking = {
      category: "demo",
      label: "Demo",
      zekerheidslabel: "light estimate",
      laatst_bijgewerkt: "2026-06-22",
      assen: [
        { key: "snelste", label: "the lowest latency", metric: "latency_ms", richting: "min", keywords: ["fastest", "latency"] },
        { key: "beste", label: "the highest score", metric: "score", richting: "max", keywords: ["most accurate", "best"] },
      ],
      providers: [
        { naam: "Alpha", provider: "A", prijs: { waarde: 10, eenheid: "$/1k", vergelijkbaar: true }, metrics: { latency_ms: 100, score: 70 }, sterk: "s", zwak: "w", bron: "b", bron_datum: "2026-06-22" },
        { naam: "Beta", provider: "B", prijs: { waarde: 5, eenheid: "$/1k", vergelijkbaar: true }, metrics: { latency_ms: 300, score: 95 }, sterk: "s", zwak: "w", bron: "b", bron_datum: "2026-06-22" },
      ],
      bronnen: [{ titel: "t", url: "https://x.test", datum: "2026-06-22" }],
      queries: {},
    };
    // "fastest" appears before "most accurate" → latency is primary → Alpha.
    const fastFirst = answerQuery(demo, "fastest most accurate api")!;
    expect(fastFirst.recommendation.default).toBe("Alpha");
    expect(fastFirst.recommendation.primary).toBe("snelste");
    // "most accurate" first → accuracy primary → Beta.
    const accFirst = answerQuery(demo, "most accurate fastest api")!;
    expect(accFirst.recommendation.default).toBe("Beta");
    expect(accFirst.recommendation.primary).toBe("beste");
    // both axes are always present regardless of order
    expect(Object.keys(fastFirst.recommendation.axes).sort()).toEqual(["beste", "snelste"]);
    expect(Object.keys(accFirst.recommendation.axes).sort()).toEqual(["beste", "snelste"]);
  });
});

// Every engine-built artefact carries routing:"matched" — it answered a real
// in-category question. The no-match signal lives on the registry/artefact path.
describe("answerQuery — routing signal", () => {
  it("a real in-category answer is routing:matched", () => {
    expect(answerQuery(ranking, "cheapest transcription API")!.routing).toBe("matched");
  });
});

// The engine is config-driven (ADR 0010): it computes winners from each
// category's own `assen` registry + `provider.metrics`, with no transcription-
// specific code. This synthetic category proves the three richtingen and the
// "prijs" sentinel work on data the engine has never seen before.
describe("answerQuery — generic over any CategorieConfig (ADR 0010)", () => {
  const demo: CategorieRanking = {
    category: "demo",
    label: "Demo",
    zekerheidslabel: "light estimate",
    laatst_bijgewerkt: "2026-06-22",
    assen: [
      { key: "snelste", label: "the lowest latency", metric: "latency_ms", richting: "min", keywords: ["fast", "latency"] },
      { key: "beste", label: "the highest score", metric: "score", richting: "max", keywords: ["best", "quality"] },
      { key: "met-stream", label: "streaming", metric: "stream", richting: "filter", keywords: ["streaming", "stream"] },
      { key: "goedkoopste", label: "the lowest price", metric: "prijs", richting: "min", keywords: ["cheap", "cheapest"] },
    ],
    providers: [
      { naam: "Alpha", provider: "A", prijs: { waarde: 10, eenheid: "$/1k", vergelijkbaar: true }, metrics: { latency_ms: 200, score: 80, stream: false }, sterk: "s", zwak: "w", bron: "b", bron_datum: "2026-06-22" },
      { naam: "Beta", provider: "B", prijs: { waarde: 5, eenheid: "$/1k", vergelijkbaar: false }, metrics: { latency_ms: 100, score: 90, stream: true }, sterk: "s", zwak: "w", bron: "b", bron_datum: "2026-06-22" },
      { naam: "Gamma", provider: "G", prijs: { waarde: 8, eenheid: "$/1k", vergelijkbaar: true }, metrics: { latency_ms: 150, score: 70, stream: true }, sterk: "s", zwak: "w", bron: "b", bron_datum: "2026-06-22" },
    ],
    bronnen: [{ titel: "t", url: "https://x.test", datum: "2026-06-22" }],
    queries: {},
  };
  const win = (q: string) => answerQuery(demo, q)!.recommendation.default;

  // Beta wins latency, score and the stream filter — non-price axes do NOT
  // exclude vergelijkbaar:false; only the price sentinel does (see below).
  it("min over a numeric metric", () => expect(win("fast api")).toBe("Beta")); // latency_ms 100
  it("max over a numeric metric", () => expect(win("best quality")).toBe("Beta")); // score 90
  it("filter picks the first provider in order with the trait", () => expect(win("streaming")).toBe("Beta")); // Alpha stream:false, Beta is first true
  it("prijs sentinel excludes vergelijkbaar:false", () => {
    // Beta is literally cheapest (5) but vergelijkbaar:false → excluded; Gamma (8) beats Alpha (10).
    expect(win("cheapest")).toBe("Gamma");
  });
  it("falls back to providers[0] when no axis matches — never 404", () =>
    expect(win("hello world")).toBe("Alpha"));
  it("composes a filter with the price ordering: 'cheapest streaming' = cheapest COMPARABLE streaming provider", () => {
    // Beta is literally cheapest (5) and streams, but vergelijkbaar:false → excluded by the
    // price sentinel; Gamma (8) streams and is comparable, so it wins the constrained pool.
    expect(win("cheapest streaming")).toBe("Gamma");
  });
});
