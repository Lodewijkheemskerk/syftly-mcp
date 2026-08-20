// Domain types for the Antwoord-artefact (ADR 0002) and its underlying
// Categorie-ranking. The ranked unit is a Provider-aanbod (ADR 0006): a
// concrete, callable API + model-tier, not a bare model or company.
//
// Multi-categorie (ADR 0010): a provider's category-specific decision-axis
// fields live in an open `metrics` map, and each category carries its own
// `assen` registry. The engine, gates, UI and MCP/JSON views are config-driven
// — they read `assen` + `metrics` + `prijs`, never hard-coded per-category
// fields. One codepath for all five focus categories (transcriptie, TTS, web
// search, scraping, OCR).

export type Zekerheidslabel = "light estimate" | "hard tested";

export interface Prijs {
  // null = no clean per-unit price (e.g. credit-priced); allowed only together
  // with vergelijkbaar:false — an honest gap, excluded from the price axis.
  waarde: number | null;
  eenheid: string; // e.g. "$/min", "$/1000min"
  // false = token-/credit-priced whose headline understates real per-unit cost,
  // so it is NOT directly comparable and is excluded from the price axis
  // (ADR 0009). Absent/true = a directly-comparable price.
  vergelijkbaar?: boolean;
}

// One categorie-specific decision-axis field on a Provider-aanbod. null = no
// Tier-1 source found (an honest gap), never "false/zero". Only number metrics
// feed min/max axes and only boolean metrics feed filter axes (ADR 0010);
// string values are descriptive metadata (e.g. an ordinal label).
export type MetricWaarde = number | boolean | string | null;

export interface ProviderAanbod {
  naam: string; // the callable offering, e.g. "Deepgram Nova-3"
  provider: string; // the company behind it, e.g. "Deepgram"
  modelFamilie?: string; // filter-as, not a row of its own (ADR 0006)
  prijs: Prijs;
  // Open, category-agnostic decision-axis fields (ADR 0010). The query-engine
  // computes the winner per axis from these + prijs, never hard-coded fields.
  metrics: Record<string, MetricWaarde>;
  sterk: string;
  zwak: string;
  bron: string; // herkomst: where this row's facts come from (ADR 0007/0008)
  bron_datum: string; // ISO date of the source
}

export interface Bron {
  titel: string;
  url: string;
  datum: string; // ISO date
}

export interface Aanbeveling {
  default: string; // naam of the recommended Provider-aanbod
  axes: Record<string, string>; // decision-as key -> recommended aanbod
  // When a compound query names 2+ ORDERING axes that point at different winners
  // and there is no composite tiebreak, `primary` is the as-key whose keyword
  // appears EARLIEST in the query — the axis whose winner became `default`. Lets
  // a machine reader see WHY this default was chosen over the other axis. Absent
  // for single-axis / composite-resolved answers (ADR 0009, Bevinding ②).
  primary?: string;
}

// The routing signal on an Antwoord-artefact (FIX 1): "matched" = the query
// landed in a real category and was answered from its ranking; "none" = no
// category matched (gibberish / out-of-scope) — an honest no-match, NOT a
// fabricated default answer; "ambiguous" = the intent fit 2+ categories with no
// tiebreak, so the agent must disambiguate. Both "none" and "ambiguous" carry
// `categories` (the supported catalogue) instead of a real recommendation.
export type Routing = "matched" | "none" | "ambiguous";

// One supported category for a no-match / disambiguation reply: the id callers
// pass back as the explicit `category`, and a human label to show the agent.
export interface SupportedCategory {
  category: string; // e.g. "web-search"
  label: string; // e.g. "Web search"
}

export interface AntwoordArtefact {
  query: string; // the human question, rendered as the page H1
  slug: string; // url slug
  category: string; // e.g. "transcription"; "" on a no-match artefact
  // The honest routing outcome (FIX 1). "matched" for every real answer.
  routing: Routing;
  hap: string; // citeerbare kern, 40-80 words (ADR 0002); the message on a no-match
  zekerheidslabel: Zekerheidslabel;
  laatst_bijgewerkt: string; // ISO date
  recommendation: Aanbeveling;
  providers: ProviderAanbod[];
  bronnen: Bron[];
  // Present only when routing !== "matched": the categories Syftly does cover, so
  // a machine (or human) can re-ask in scope. Omitted on a matched answer.
  categories?: SupportedCategory[];
}

// The query-specific slice of an artefact: what differs per published query.
// The shared ranking (providers, bronnen, freshness) lives on CategorieRanking.
export interface QueryView {
  query: string; // the human question
  hap: string; // citeerbare kern for this query (ADR 0002)
  recommendation: Aanbeveling;
}

export type Richting = "min" | "max" | "filter";

// A Beslis-as (ADR 0009/0010): the winner is COMPUTED from a provider metric.
// `metric` keys into ProviderAanbod.metrics, or is the reserved sentinel "prijs"
// (reads prijs.waarde and excludes non-comparable token/credit pricing).
// `richting`: min/max over a numeric metric, or "filter" = the first provider in
// ranking order whose boolean metric is true. `keywords` map a free query to
// this axis (substring, LLM-free). Optional `caveat` is woven into the templated
// long-tail hap to keep the honest signal (e.g. an English-leaning benchmark).
export interface Beslisas {
  key: string;
  label: string;
  metric: string;
  richting: Richting;
  keywords: string[];
  caveat?: string;
  // Optional UI display hints (ADR 0010): an axis appears in the provider-table
  // IFF it declares a `kolom` — a numeric axis as a value column, a filter axis
  // as a capability badge. `kolom` is the short column-header / badge label;
  // `eenheid` is the unit suffix on a numeric value (e.g. "%", " ms"). The price
  // sentinel carries its unit in the header instead, so it needs no `eenheid`.
  // Axes without a `kolom` (a composite score, or a filter already covered by
  // another column) stay routing-only and out of the table.
  kolom?: string;
  eenheid?: string;
}

// The knowledge atom (ADR 0002/0005) plus its per-category axis-config (ADR
// 0010): one ordered Provider-aanbod list, the decision-axes registry, shared
// provenance, and the published query-views. Each AntwoordArtefact is a
// projection of this for one query (slug -> QueryView for the etalage, or a live
// engine answer for the long tail), so the endpoint is a query-engine over the
// ranking, not a fixed inventory of pages. The `assen` config travels with the
// ranking because both are produced by the same Onderzoeksrecept run (ADR 0008).
export interface CategorieRanking {
  category: string;
  label: string; // human label, e.g. "Transcription"
  insluit_regel?: string; // documented include-rule, provenance (ADR 0006)
  zekerheidslabel: Zekerheidslabel;
  laatst_bijgewerkt: string; // ISO date
  assen: Beslisas[];
  providers: ProviderAanbod[];
  bronnen: Bron[];
  queries: Record<string, QueryView>; // slug -> the per-query view
}
