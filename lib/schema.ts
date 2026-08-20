// JSON Schema for the Antwoord-artefact: the machine contract served as the
// MCP tool's `outputSchema` (ADR 0002, MCP rev 2025-06-18). One source of
// truth, mirroring lib/types.ts. The drift-guard test (lib/mcp.test.ts) asserts
// a real artefact carries every top-level required key, so this stays honest.

const PROVIDER_AANBOD_SCHEMA = {
  type: "object",
  required: ["naam", "provider", "prijs", "metrics", "sterk", "zwak", "bron", "bron_datum"],
  properties: {
    naam: { type: "string", description: "The callable offering, e.g. 'Deepgram Nova-3'." },
    provider: { type: "string", description: "The company behind it, e.g. 'Deepgram'." },
    modelFamilie: { type: "string", description: "Filter-as, not a row of its own (ADR 0006)." },
    prijs: {
      type: "object",
      required: ["waarde", "eenheid"],
      properties: {
        waarde: { type: ["number", "null"] },
        eenheid: { type: "string", description: "e.g. '$/min', '$/1000min'." },
        vergelijkbaar: {
          type: "boolean",
          description: "false = token-/credit-priced, not directly comparable (ADR 0009).",
        },
      },
    },
    metrics: {
      type: "object",
      description:
        "Open category-specific decision-axis fields (ADR 0010). Values are number, boolean, string or null (null = an honest gap, no Tier-1 source). Number metrics back min/max axes; boolean metrics back filter axes.",
      additionalProperties: { type: ["number", "boolean", "string", "null"] },
    },
    sterk: { type: "string" },
    zwak: { type: "string" },
    bron: { type: "string", description: "Herkomst of this row's facts (ADR 0007/0008)." },
    bron_datum: { type: "string", description: "ISO date of the source." },
  },
} as const;

const BRON_SCHEMA = {
  type: "object",
  required: ["titel", "url", "datum"],
  properties: {
    titel: { type: "string" },
    url: { type: "string", format: "uri" },
    datum: { type: "string", description: "ISO date." },
  },
} as const;

const SUPPORTED_CATEGORY_SCHEMA = {
  type: "object",
  required: ["category", "label"],
  properties: {
    category: { type: "string", description: "Supported category id, e.g. 'web-search'." },
    label: { type: "string", description: "Human label, e.g. 'Web search'." },
  },
} as const;

export const ANTWOORD_ARTEFACT_SCHEMA = {
  type: "object",
  required: [
    "query",
    "slug",
    "category",
    "routing",
    "hap",
    "zekerheidslabel",
    "laatst_bijgewerkt",
    "recommendation",
    "providers",
    "bronnen",
  ],
  properties: {
    query: { type: "string", description: "The human question (page H1)." },
    slug: { type: "string" },
    category: { type: "string", description: "e.g. 'transcription'; '' on a no-match." },
    routing: {
      type: "string",
      enum: ["matched", "none", "ambiguous"],
      description:
        "Honest routing outcome (FIX 1): 'matched' = answered from a real category; 'none' = no category matched (out-of-scope/gibberish) — an honest no-match, not a fabricated answer; 'ambiguous' = fit 2+ categories. 'none'/'ambiguous' carry `categories` and no real recommendation/providers.",
    },
    hap: {
      type: "string",
      description:
        "Citeerbare kern, 40-80 words, reused verbatim across all views (ADR 0002). On a no-match, the plain-language message.",
    },
    zekerheidslabel: {
      type: "string",
      enum: ["light estimate", "hard tested"],
      description: "Confidence/depth label (ADR 0001).",
    },
    laatst_bijgewerkt: { type: "string", description: "ISO date." },
    recommendation: {
      type: "object",
      required: ["default", "axes"],
      properties: {
        default: { type: "string", description: "Naam of the recommended Provider-aanbod ('' on a no-match)." },
        axes: {
          type: "object",
          description: "Decision-as -> recommended aanbod. Carries EVERY matched axis (FIX 2): filters + all ordering axes, each naming its own computed winner.",
          additionalProperties: { type: "string" },
        },
        primary: {
          type: "string",
          description:
            "The as-key whose winner became `default` when 2+ ordering axes conflict with no composite tiebreak — the earliest-in-query axis (FIX 2). Absent for single-axis/composite-resolved answers.",
        },
      },
    },
    providers: { type: "array", items: PROVIDER_AANBOD_SCHEMA },
    bronnen: { type: "array", items: BRON_SCHEMA },
    categories: {
      type: "array",
      description: "Present only when routing !== 'matched': the supported categories so the caller can re-ask in scope (FIX 1).",
      items: SUPPORTED_CATEGORY_SCHEMA,
    },
  },
  additionalProperties: false,
} as const;
