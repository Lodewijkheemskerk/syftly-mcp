import type {
  AntwoordArtefact,
  Aanbeveling,
  Bron,
  Prijs,
  ProviderAanbod,
  Routing,
  SupportedCategory,
  Zekerheidslabel,
  MetricWaarde,
} from "@/lib/types";

// The English machine contract for the Antwoord-artefact (parked "Bevinding ③").
//
// The internal engine, gates and human pages keep Dutch field names — that is
// deliberate and cheap to leave alone. This module is the thin translation layer
// at the API boundary: a pure projection that maps the Dutch-keyed internal
// artefact to an English-keyed PUBLIC shape, plus the JSON Schema that advertises
// that same public shape as the MCP tool's outputSchema. Applying the projection
// only at the machine edge (MCP structuredContent + REST JSON) keeps one honest
// English contract for callers without churning the whole internal codebase.
//
// Values are copied verbatim; only KEYS are renamed. Metric keys inside the open
// `metrics` map (wer, latency_ms, taal_nl, …) are DATA IDENTIFIERS, not prose, so
// they are carried through unchanged — renaming them would break the axis config
// they key into.

// ----- Public TypeScript types (English-keyed) -----

export interface PublicPrice {
  value: number | null; // was Prijs.waarde
  unit: string; // was Prijs.eenheid
  comparable?: boolean; // was Prijs.vergelijkbaar
}

export interface PublicProvider {
  name: string; // was ProviderAanbod.naam
  provider: string; // the company (already English)
  model_family?: string; // was ProviderAanbod.modelFamilie
  price: PublicPrice; // was prijs
  metrics: Record<string, MetricWaarde>; // keys unchanged (data identifiers)
  strengths: string; // was sterk
  weaknesses: string; // was zwak
  source: string; // was bron
  source_date: string; // was bron_datum
}

export interface PublicSource {
  title: string; // was Bron.titel
  url: string;
  date: string; // was Bron.datum
}

// recommendation is already English (default / axes / primary); re-exported as-is.
export type PublicRecommendation = Aanbeveling;
export type PublicSupportedCategory = SupportedCategory;

export interface PublicArtefact {
  query: string;
  slug: string;
  category: string;
  routing: Routing;
  summary: string; // was hap
  confidence: Zekerheidslabel; // was zekerheidslabel
  updated: string; // was laatst_bijgewerkt
  recommendation: PublicRecommendation;
  providers: PublicProvider[];
  sources: PublicSource[]; // was bronnen
  categories?: PublicSupportedCategory[]; // present only on a no-match
}

// ----- Pure projection -----

function toPublicPrice(p: Prijs): PublicPrice {
  const out: PublicPrice = { value: p.waarde, unit: p.eenheid };
  // Preserve the honest signal only when the source carries it (absent = comparable).
  if (p.vergelijkbaar !== undefined) out.comparable = p.vergelijkbaar;
  return out;
}

function toPublicProvider(p: ProviderAanbod): PublicProvider {
  const out: PublicProvider = {
    name: p.naam,
    provider: p.provider,
    price: toPublicPrice(p.prijs),
    metrics: p.metrics,
    strengths: p.sterk,
    weaknesses: p.zwak,
    source: p.bron,
    source_date: p.bron_datum,
  };
  if (p.modelFamilie !== undefined) out.model_family = p.modelFamilie;
  return out;
}

function toPublicSource(b: Bron): PublicSource {
  return { title: b.titel, url: b.url, date: b.datum };
}

/**
 * Project the internal Dutch-keyed artefact to the English public contract.
 * Pure: no mutation, values carried verbatim, only keys renamed. Handles the
 * no-match shape too (empty providers/sources + a `categories` catalogue).
 */
export function toPublicArtefact(a: AntwoordArtefact): PublicArtefact {
  const out: PublicArtefact = {
    query: a.query,
    slug: a.slug,
    category: a.category,
    routing: a.routing,
    summary: a.hap,
    confidence: a.zekerheidslabel,
    updated: a.laatst_bijgewerkt,
    recommendation: a.recommendation,
    providers: a.providers.map(toPublicProvider),
    sources: a.bronnen.map(toPublicSource),
  };
  if (a.categories !== undefined) out.categories = a.categories;
  return out;
}

// ----- Public JSON Schema (the MCP tool's outputSchema) -----
// Mirrors lib/schema.ts (the internal contract) but with the English keys above.
// Kept in this module because it is part of the SAME public contract as the
// projection; the drift-guard test asserts a real projected artefact carries
// every required key here.

const PUBLIC_PROVIDER_SCHEMA = {
  type: "object",
  required: ["name", "provider", "price", "metrics", "strengths", "weaknesses", "source", "source_date"],
  properties: {
    name: { type: "string", description: "The callable offering, e.g. 'Deepgram Nova-3'." },
    provider: { type: "string", description: "The company behind it, e.g. 'Deepgram'." },
    model_family: { type: "string", description: "Filter attribute, not a row of its own." },
    price: {
      type: "object",
      required: ["value", "unit"],
      properties: {
        value: { type: ["number", "null"] },
        unit: { type: "string", description: "e.g. '$/min', '$/1000min'." },
        comparable: {
          type: "boolean",
          description: "false = token-/credit-priced, not directly comparable (excluded from the price axis).",
        },
      },
    },
    metrics: {
      type: "object",
      description:
        "Open category-specific decision-axis fields. Keys are stable data identifiers (e.g. 'wer', 'latency_ms'); values are number, boolean, string or null (null = an honest gap). Number metrics back min/max axes; boolean metrics back filter axes.",
      additionalProperties: { type: ["number", "boolean", "string", "null"] },
    },
    strengths: { type: "string" },
    weaknesses: { type: "string" },
    source: { type: "string", description: "Where this row's facts come from." },
    source_date: { type: "string", description: "ISO date of the source." },
  },
} as const;

const PUBLIC_SOURCE_SCHEMA = {
  type: "object",
  required: ["title", "url", "date"],
  properties: {
    title: { type: "string" },
    url: { type: "string", format: "uri" },
    date: { type: "string", description: "ISO date." },
  },
} as const;

const PUBLIC_SUPPORTED_CATEGORY_SCHEMA = {
  type: "object",
  required: ["category", "label"],
  properties: {
    category: { type: "string", description: "Supported category id, e.g. 'web-search'." },
    label: { type: "string", description: "Human label, e.g. 'Web search'." },
  },
} as const;

export const PUBLIC_ARTEFACT_SCHEMA = {
  type: "object",
  required: [
    "query",
    "slug",
    "category",
    "routing",
    "summary",
    "confidence",
    "updated",
    "recommendation",
    "providers",
    "sources",
  ],
  properties: {
    query: { type: "string", description: "The human question (page H1)." },
    slug: { type: "string" },
    category: { type: "string", description: "e.g. 'transcription'; '' on a no-match." },
    routing: {
      type: "string",
      enum: ["matched", "none", "ambiguous"],
      description:
        "Honest routing outcome: 'matched' = answered from a real category; 'none' = no category matched (out-of-scope/gibberish) — an honest no-match, not a fabricated answer; 'ambiguous' = fit 2+ categories. 'none'/'ambiguous' carry `categories` and no real recommendation/providers.",
    },
    summary: {
      type: "string",
      description:
        "Citeable summary, 40-80 words, reused verbatim across all views. On a no-match, the plain-language message.",
    },
    confidence: {
      type: "string",
      enum: ["light estimate", "hard tested"],
      description: "Confidence/depth label.",
    },
    updated: { type: "string", description: "ISO date." },
    recommendation: {
      type: "object",
      required: ["default", "axes"],
      properties: {
        default: { type: "string", description: "Name of the recommended offering ('' on a no-match)." },
        axes: {
          type: "object",
          description:
            "Decision-axis -> recommended offering. Carries EVERY matched axis: filters + all ordering axes, each naming its own computed winner.",
          additionalProperties: { type: "string" },
        },
        primary: {
          type: "string",
          description:
            "The axis key whose winner became `default` when 2+ ordering axes conflict with no composite tiebreak — the earliest-in-query axis. Absent for single-axis/composite-resolved answers.",
        },
      },
    },
    providers: { type: "array", items: PUBLIC_PROVIDER_SCHEMA },
    sources: { type: "array", items: PUBLIC_SOURCE_SCHEMA },
    categories: {
      type: "array",
      description: "Present only when routing !== 'matched': the supported categories so the caller can re-ask in scope.",
      items: PUBLIC_SUPPORTED_CATEGORY_SCHEMA,
    },
  },
  additionalProperties: false,
} as const;
