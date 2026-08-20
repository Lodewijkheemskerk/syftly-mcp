import { describe, it, expect } from "vitest";
import { toPublicArtefact, PUBLIC_ARTEFACT_SCHEMA } from "@/lib/contract";
import { getArtefactByQuery } from "@/lib/artefact";
import type { AntwoordArtefact } from "@/lib/types";

// The English machine contract (Bevinding ③): a pure projection from the internal
// Dutch-keyed artefact to the English public shape served at the API boundary.
const KNOWN_QUERY = "Best transcription API for Dutch";

const MATCHED: AntwoordArtefact = {
  query: "Best transcription API for Dutch",
  slug: "best-transcription-api-for-dutch",
  category: "transcription",
  routing: "matched",
  hap: "For Dutch speech-to-text, ElevenLabs Scribe v2 tops the leaderboard.",
  zekerheidslabel: "light estimate",
  laatst_bijgewerkt: "2026-06-19",
  recommendation: {
    default: "ElevenLabs Scribe v2",
    axes: { goedkoopste: "AssemblyAI Universal-3 Pro" },
    primary: "hoogste-nauwkeurigheid",
  },
  providers: [
    {
      naam: "ElevenLabs Scribe v2",
      provider: "ElevenLabs",
      modelFamilie: "Scribe",
      prijs: { waarde: 3.67, eenheid: "$/1000 min", vergelijkbaar: true },
      metrics: { wer: 2.2, latency_ms: 150, taal_nl: true },
      sterk: "Highest accuracy",
      zwak: "Mid-pack price",
      bron: "Artificial Analysis",
      bron_datum: "2026-06-19",
    },
    {
      naam: "Google Gemini 3 Flash",
      provider: "Google",
      prijs: { waarde: 1.92, eenheid: "$/1000 min", vergelijkbaar: false },
      metrics: { wer: 4.1 },
      sterk: "Cheap headline",
      zwak: "Token-priced",
      bron: "Google docs",
      bron_datum: "2026-06-18",
    },
  ],
  bronnen: [{ titel: "Artificial Analysis ASR", url: "https://artificialanalysis.ai/asr", datum: "2026-06-10" }],
};

describe("toPublicArtefact — key mapping (Dutch -> English)", () => {
  const pub = toPublicArtefact(MATCHED);

  it("maps the top-level artefact keys", () => {
    expect(pub.summary).toBe(MATCHED.hap);
    expect(pub.confidence).toBe(MATCHED.zekerheidslabel);
    expect(pub.updated).toBe(MATCHED.laatst_bijgewerkt);
    // English-already keys carry through unchanged.
    expect(pub.query).toBe(MATCHED.query);
    expect(pub.slug).toBe(MATCHED.slug);
    expect(pub.category).toBe(MATCHED.category);
    expect(pub.routing).toBe(MATCHED.routing);
    expect(pub.recommendation).toEqual(MATCHED.recommendation);
  });

  it("does NOT leak any Dutch top-level keys", () => {
    const keys = Object.keys(pub);
    for (const dutch of ["hap", "zekerheidslabel", "laatst_bijgewerkt", "bronnen"]) {
      expect(keys).not.toContain(dutch);
    }
  });

  it("maps provider keys, including price and source subfields", () => {
    const p = pub.providers[0];
    expect(p.name).toBe("ElevenLabs Scribe v2");
    expect(p.model_family).toBe("Scribe");
    expect(p.price.value).toBe(3.67);
    expect(p.price.unit).toBe("$/1000 min");
    expect(p.price.comparable).toBe(true);
    expect(p.strengths).toBe("Highest accuracy");
    expect(p.weaknesses).toBe("Mid-pack price");
    expect(p.source).toBe("Artificial Analysis");
    expect(p.source_date).toBe("2026-06-19");
  });

  it("keeps the open metrics map keys unchanged — they are data identifiers", () => {
    expect(pub.providers[0].metrics).toEqual({ wer: 2.2, latency_ms: 150, taal_nl: true });
  });

  it("preserves the honest non-comparable price signal", () => {
    expect(pub.providers[1].price.comparable).toBe(false);
  });

  it("omits comparable when the internal price left it absent", () => {
    const noVergelijkbaar: AntwoordArtefact = {
      ...MATCHED,
      providers: [{ ...MATCHED.providers[0], prijs: { waarde: 1, eenheid: "$/min" } }],
    };
    const p = toPublicArtefact(noVergelijkbaar).providers[0];
    expect("comparable" in p.price).toBe(false);
  });

  it("maps source (bron) keys", () => {
    const s = pub.sources[0];
    expect(s.title).toBe("Artificial Analysis ASR");
    expect(s.url).toBe("https://artificialanalysis.ai/asr");
    expect(s.date).toBe("2026-06-10");
  });

  it("does not mutate the input artefact", () => {
    const snapshot = JSON.parse(JSON.stringify(MATCHED));
    toPublicArtefact(MATCHED);
    expect(MATCHED).toEqual(snapshot);
  });
});

describe("toPublicArtefact — no-match shape", () => {
  const noMatch: AntwoordArtefact = {
    query: "best image generation API",
    slug: "best-image-generation-api",
    category: "",
    routing: "none",
    hap: "Syftly doesn't cover that task yet.",
    zekerheidslabel: "light estimate",
    laatst_bijgewerkt: "2026-06-22",
    recommendation: { default: "", axes: {} },
    providers: [],
    bronnen: [],
    categories: [
      { category: "transcription", label: "Transcription" },
      { category: "ocr", label: "OCR & document extraction" },
    ],
  };

  it("carries the supported-category catalogue through", () => {
    const pub = toPublicArtefact(noMatch);
    expect(pub.routing).toBe("none");
    expect(pub.summary).toBe(noMatch.hap);
    expect(pub.providers).toEqual([]);
    expect(pub.sources).toEqual([]);
    expect(pub.categories).toEqual(noMatch.categories);
  });

  it("omits categories on a matched artefact", () => {
    expect("categories" in toPublicArtefact(MATCHED)).toBe(false);
  });
});

describe("PUBLIC_ARTEFACT_SCHEMA — drift guard against a real projected artefact", () => {
  it("every top-level required key exists on a real projected artefact", () => {
    const pub = toPublicArtefact(getArtefactByQuery(KNOWN_QUERY)!) as unknown as Record<
      string,
      unknown
    >;
    for (const key of PUBLIC_ARTEFACT_SCHEMA.required) {
      expect(pub[key]).toBeDefined();
    }
  });

  it("a real projected artefact satisfies the nested required fields", () => {
    const pub = toPublicArtefact(getArtefactByQuery(KNOWN_QUERY)!);
    const props = PUBLIC_ARTEFACT_SCHEMA.properties;

    const providerRequired = props.providers.items.required;
    const priceRequired = props.providers.items.properties.price.required;
    for (const p of pub.providers) {
      const row = p as unknown as Record<string, unknown>;
      for (const key of providerRequired) expect(row[key]).toBeDefined();
      const price = p.price as unknown as Record<string, unknown>;
      for (const key of priceRequired) expect(price[key]).toBeDefined();
    }

    for (const key of props.recommendation.required) {
      expect((pub.recommendation as unknown as Record<string, unknown>)[key]).toBeDefined();
    }

    const sourceRequired = props.sources.items.required;
    for (const b of pub.sources) {
      const src = b as unknown as Record<string, unknown>;
      for (const key of sourceRequired) expect(src[key]).toBeDefined();
    }
  });

  it("advertises English keys, not Dutch, in the schema", () => {
    const props = PUBLIC_ARTEFACT_SCHEMA.properties as Record<string, unknown>;
    expect(props.summary).toBeDefined();
    expect(props.confidence).toBeDefined();
    expect(props.updated).toBeDefined();
    expect(props.sources).toBeDefined();
    expect(props.hap).toBeUndefined();
    expect(props.bronnen).toBeUndefined();
  });
});
