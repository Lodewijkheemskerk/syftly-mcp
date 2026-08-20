import type {
  AntwoordArtefact,
  Beslisas,
  CategorieRanking,
  ProviderAanbod,
  Routing,
  SupportedCategory,
} from "@/lib/types";
import { slugify } from "@/lib/slug";

// The query-engine over the Categorie-ranking (ADR 0009), now config-driven
// (ADR 0010). A free in-category question is mapped — deterministically, LLM-
// free — to a Beslis-as from the category's own `assen` registry; the winner is
// COMPUTED from `provider.metrics` (or `prijs`), then rendered as an Antwoord-
// artefact. No transcription-specific code: the same engine drives all five
// focus categories. A new recept-run changes the numbers and the winner
// recomputes by itself (herkomst = recept + dated sources, ADR 0007/8).

// Reserved metric: the price axis reads `prijs.waarde` and excludes non-
// comparable (token-/credit-priced) offerings, whose headline understates real
// per-unit cost and would game "cheapest" (ADR 0009).
export const PRIJS_METRIC = "prijs";

function metricValue(p: ProviderAanbod, metric: string): number | boolean | string | null {
  if (metric === PRIJS_METRIC) return p.prijs.waarde;
  const v = p.metrics?.[metric];
  return v === undefined ? null : v;
}

// Providers eligible for a numeric axis: a real number for the metric, and — for
// the price axis only — directly comparable (vergelijkbaar !== false). Operates
// on an arbitrary provider pool so the same rule applies to a full ranking or to
// a pool already narrowed by filter constraints (composition, see answerQuery).
function numericPool(providers: ProviderAanbod[], axis: Beslisas): ProviderAanbod[] {
  let pool = providers;
  if (axis.metric === PRIJS_METRIC) pool = pool.filter((p) => p.prijs.vergelijkbaar !== false);
  return pool.filter((p) => typeof metricValue(p, axis.metric) === "number");
}

// min/max over a numeric metric; ties resolve to the earlier (higher-ranked)
// provider, since reduce keeps the incumbent unless strictly beaten.
function pickNumeric(providers: ProviderAanbod[], axis: Beslisas): ProviderAanbod | null {
  const pool = numericPool(providers, axis);
  if (pool.length === 0) return null;
  return pool.reduce((best, p) => {
    const vp = metricValue(p, axis.metric) as number;
    const vb = metricValue(best, axis.metric) as number;
    const better = axis.richting === "max" ? vp > vb : vp < vb;
    return better ? p : best;
  });
}

// Filter axis: the highest-ranked (earliest in the ordered pool) provider whose
// boolean metric is true.
function pickFilter(providers: ProviderAanbod[], axis: Beslisas): ProviderAanbod | null {
  return providers.find((p) => metricValue(p, axis.metric) === true) ?? null;
}

/** Compute the winning Provider-aanbod for one axis (null if none qualifies). */
export function pickWinner(ranking: CategorieRanking, axis: Beslisas): ProviderAanbod | null {
  return axis.richting === "filter"
    ? pickFilter(ranking.providers, axis)
    : pickNumeric(ranking.providers, axis);
}

/** The cheapest directly-comparable provider-aanbod (lowest comparable price). */
export function cheapest(ranking: CategorieRanking): ProviderAanbod | null {
  return pickNumeric(ranking.providers, {
    key: "goedkoopste",
    label: "the lowest price",
    metric: PRIJS_METRIC,
    richting: "min",
    keywords: [],
  });
}

// The canonical axis-key → picker map for a ranking, derived straight from its
// own `assen` so it can never drift from the engine. The kwaliteitspoort
// (gates.ts) reuses these exact pickers to assert that every hand-written
// etalage recommendation names the COMPUTED winner — the etalage can't
// contradict the engine (ADR 0009).
export function axisPickers(
  ranking: CategorieRanking,
): Record<string, () => ProviderAanbod | null> {
  return Object.fromEntries(ranking.assen.map((a) => [a.key, () => pickWinner(ranking, a)]));
}

const SOURCES_CAVEAT =
  "A light estimate aggregated from public benchmarks — see the sources below — not a first-hand measurement.";

function metricText(p: ProviderAanbod, axis: Beslisas): string {
  if (axis.metric === PRIJS_METRIC) return `${p.prijs.waarde} ${p.prijs.eenheid}`;
  return String(metricValue(p, axis.metric));
}

// Long-tail haps are templated from the axis + computed winner (etalage haps
// stay hand-written, ADR 0010). These pages are noindex (ADR 0009), so the
// template only needs to be honest and self-contained, not SEO-tuned. The
// optional per-axis caveat carries forward signals like an English-leaning
// benchmark or heterogeneous latency.
function axisHap(ranking: CategorieRanking, axis: Beslisas, winner: ProviderAanbod): string {
  const cat = ranking.label.toLowerCase();
  const caveat = axis.caveat ? `${axis.caveat} ` : "";
  if (axis.richting === "filter") {
    return `For ${cat} with ${axis.label.toLowerCase()}, ${winner.naam} (${winner.provider}) is the top-ranked option that supports it. ${caveat}${SOURCES_CAVEAT}`;
  }
  return `For ${axis.label.toLowerCase()}, the top pick in this ${cat} ranking is ${winner.naam} (${winner.provider}) (${metricText(winner, axis)}). ${caveat}${SOURCES_CAVEAT}`;
}

// Compound hap: a query that constrains by one or more filters AND ranks by an
// ordering axis. Names BOTH dimensions explicitly (e.g. "Dutch support and the
// lowest price") so the agent sees that the winner satisfies the constraint and
// wins the metric — not a bare "top-ranked option that supports it". Caveats
// from every contributing axis carry forward, de-duplicated.
function composedHap(
  ranking: CategorieRanking,
  ordering: Beslisas,
  filters: Beslisas[],
  winner: ProviderAanbod,
): string {
  const cat = ranking.label.toLowerCase();
  const filterLabels = filters.map((f) => f.label.toLowerCase()).join(" and ");
  const caveatList = [...filters, ordering].map((a) => a.caveat).filter((c): c is string => !!c);
  const uniqueCaveats = caveatList.filter((c, i) => caveatList.indexOf(c) === i);
  const caveat = uniqueCaveats.length > 0 ? `${uniqueCaveats.join(" ")} ` : "";
  return `For ${cat} with ${filterLabels} and ${ordering.label.toLowerCase()}, ${winner.naam} (${winner.provider}) (${metricText(winner, ordering)}) is the best match. ${caveat}${SOURCES_CAVEAT}`;
}

// Trade-off hap (Bevinding ②): a query that names 2+ ORDERING axes with
// different winners. It must state the trade-off — each axis and its own winner —
// and NEVER reframe a 2-axis question as a 1-axis one. The primary axis (earliest
// keyword in the query) leads; the others follow. Filter constraints, if any,
// are named first. Caveats from every contributing axis carry forward, deduped.
function tradeoffHap(
  ranking: CategorieRanking,
  orderingWinners: Array<{ axis: Beslisas; winner: ProviderAanbod }>,
  filters: Beslisas[],
): string {
  const cat = ranking.label.toLowerCase();
  const filterClause =
    filters.length > 0 ? ` with ${filters.map((f) => f.label.toLowerCase()).join(" and ")}` : "";
  // "Lowest price: X (value). Highest accuracy: Y (value)."
  const clauses = orderingWinners
    .map(({ axis, winner }) => {
      const label = axis.label.toLowerCase().replace(/^the /, "");
      const cap = label.charAt(0).toUpperCase() + label.slice(1);
      return `${cap}: ${winner.naam} (${metricText(winner, axis)}).`;
    })
    .join(" ");
  const contributing = [...filters, ...orderingWinners.map((o) => o.axis)];
  const caveatList = contributing.map((a) => a.caveat).filter((c): c is string => !!c);
  const uniqueCaveats = caveatList.filter((c, i) => caveatList.indexOf(c) === i);
  const caveat = uniqueCaveats.length > 0 ? `${uniqueCaveats.join(" ")} ` : "";
  return `For ${cat}${filterClause}, these axes point to different winners. ${clauses} ${caveat}${SOURCES_CAVEAT}`;
}

// The provider pool after applying the filter axes as AND-constraints. Returns
// the (possibly empty) filtered pool; the caller decides what an empty pool means.
function filteredPool(providers: ProviderAanbod[], filters: Beslisas[]): ProviderAanbod[] {
  let pool = providers;
  for (const f of filters) pool = pool.filter((p) => metricValue(p, f.metric) === true);
  return pool;
}

// The metric that signals the price-to-accuracy COMPOSITE axis (ADR 0010): an
// ordering axis whose winner already balances cost and quality. When a query
// names exactly price + accuracy, this composite is the honest single default.
const COMPOSITE_METRIC = "waarde_score";

// Heuristic accuracy-axis markers: an ordering axis counts as the "accuracy" axis
// of the price+accuracy pair if its metric or key signals accuracy. Kept small
// and data-driven (no per-category branching in the engine).
function isAccuracyAxis(axis: Beslisas): boolean {
  const s = `${axis.key} ${axis.metric}`.toLowerCase();
  return s.includes("wer") || s.includes("nauwkeurig") || s.includes("accuracy");
}

function isPriceAxis(axis: Beslisas): boolean {
  return axis.metric === PRIJS_METRIC;
}

/**
 * Answer a free in-category query from the ranking. Returns null only for an
 * empty question; any non-empty in-category question gets an answer (never 404,
 * ADR 0009).
 *
 * Compound queries COMPOSE (Bevinding ①/②): every axis whose keywords match is
 * collected, split into FILTER axes (boolean AND-constraints on the pool) and
 * ORDERING axes (min/max, incl. the "prijs" sentinel). The filters narrow the
 * pool, then EVERY ordering axis is computed WITHIN that pool — none is silently
 * dropped (Bevinding ②). recommendation.axes names each axis's own winner.
 *
 * The single `default` headline: with one ordering axis, its winner. With the
 * price+accuracy pair AND a composite value axis present, the composite winner.
 * Otherwise, when ordering axes point at different winners, the PRIMARY axis (the
 * one whose keyword appears EARLIEST in the query, fixing the word-order bug)
 * sets the default and the hap states the trade-off naming each axis + winner.
 * A filter-only match keeps the legacy first-filter pick. When nothing matches —
 * or the constraints leave no computable winner — it falls back to the category
 * default = providers[0], the top of the ordered ranking.
 */
/**
 * Does the query hit ANY decision-axis keyword of this ranking? The axis-side
 * half of the long-tail gate (lib/artefact resolveBySlug): "cheapest-option"
 * shows real in-category intent even without a category keyword, so it earns an
 * engine answer; an arbitrary string matches nothing and must not.
 */
export function matchesAxis(ranking: CategorieRanking, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return false;
  return ranking.assen.some((axis) => axis.keywords.some((k) => q.includes(k.toLowerCase())));
}

export function answerQuery(ranking: CategorieRanking, query: string): AntwoordArtefact | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;
  const q = trimmed.toLowerCase();

  // The earliest position any of an axis's keywords appears at — the word-order
  // signal that picks the primary ordering axis (Bevinding ②). Infinity = no hit.
  const firstHit = (axis: Beslisas): number =>
    axis.keywords.reduce((min, k) => {
      const i = q.indexOf(k.toLowerCase());
      return i >= 0 && i < min ? i : min;
    }, Number.POSITIVE_INFINITY);

  const matched = ranking.assen.filter((axis) => firstHit(axis) < Number.POSITIVE_INFINITY);
  const filters = matched.filter((a) => a.richting === "filter");
  const orderings = matched.filter((a) => a.richting !== "filter");

  if (matched.length > 0) {
    const pool = filteredPool(ranking.providers, filters);
    if (pool.length > 0) {
      // Compute every ordering axis within the filtered pool; keep only the ones
      // that actually resolve to a winner (a null metric across the pool drops it).
      // Sorted by QUERY order (earliest keyword first) so index 0 is the primary
      // axis — this is the word-order fix (Bevinding ②): config order no longer
      // decides which axis the headline default follows.
      const orderingWinners = orderings
        .map((axis) => ({ axis, winner: pickNumeric(pool, axis) }))
        .filter((o): o is { axis: Beslisas; winner: ProviderAanbod } => o.winner !== null)
        .sort((a, b) => firstHit(a.axis) - firstHit(b.axis));

      const built = pickDefault(ranking, pool, filters, orderingWinners);
      if (built) {
        // The axis → winner map: every resolved ordering axis names its own
        // computed winner; every filter axis names the headline default (the
        // composed winner that satisfies the constraint — Bevinding ①), or the
        // top of the filtered pool when filter-only.
        const axes: Record<string, string> = {};
        for (const { axis, winner } of orderingWinners) axes[axis.key] = winner.naam;
        for (const f of filters) axes[f.key] = built.winner.naam;
        if (built.extraAxis) axes[built.extraAxis.key] = built.extraAxis.naam;
        return build(ranking, trimmed, built.winner, axes, built.hap, built.primary);
      }
    }
  }

  // No axis matched, or the constraints leave no computable winner: serve the
  // category default (top of the ordered ranking).
  const fallback = ranking.providers[0];
  const hap =
    `Across this ${ranking.label.toLowerCase()} ranking, the overall default pick is ` +
    `${fallback.naam} (${fallback.provider}). Compare the providers below on price and the ` +
    `other decision-axes. ${SOURCES_CAVEAT}`;
  return build(ranking, trimmed, fallback, {}, hap);
}

// Resolve the single `default` headline + hap (+ optional primary axis) from the
// composed pool, filters and the resolved ordering winners. Returns null when no
// usable winner can be formed (the caller degrades to the category default).
function pickDefault(
  ranking: CategorieRanking,
  pool: ProviderAanbod[],
  filters: Beslisas[],
  orderingWinners: Array<{ axis: Beslisas; winner: ProviderAanbod }>,
): {
  winner: ProviderAanbod;
  hap: string;
  primary?: string;
  extraAxis?: { key: string; naam: string };
} | null {
  // Filter-only match: the highest-ranked provider that satisfies every filter.
  if (orderingWinners.length === 0) {
    if (filters.length === 0) return null; // nothing computable
    const winner = pool[0];
    const hap =
      filters.length > 0
        ? composedHapFiltersOnly(ranking, filters, winner)
        : axisHap(ranking, filters[0], winner);
    return { winner, hap };
  }

  // Single ordering axis (+ optional filters): the existing composed/single hap.
  if (orderingWinners.length === 1) {
    const { axis, winner } = orderingWinners[0];
    const hap =
      filters.length > 0
        ? composedHap(ranking, axis, filters, winner)
        : axisHap(ranking, axis, winner);
    return { winner, hap };
  }

  // 2+ ordering axes. If the COMPOSITE value axis is itself among them (the user
  // asked for "value" / "good accuracy"), its balance winner is the headline —
  // value already weighs price against accuracy, so it is the honest single
  // answer even when bare price and bare accuracy also matched (ADR 0009/0010).
  const composite = ranking.assen.find((a) => a.metric === COMPOSITE_METRIC);
  const matchedComposite = orderingWinners.find((o) => o.axis.metric === COMPOSITE_METRIC);
  if (matchedComposite) {
    const hap =
      filters.length > 0
        ? composedHap(ranking, matchedComposite.axis, filters, matchedComposite.winner)
        : axisHap(ranking, matchedComposite.axis, matchedComposite.winner);
    return { winner: matchedComposite.winner, hap };
  }

  // If every ordering winner agrees, one default with a single hap.
  const distinct = new Set(orderingWinners.map((o) => o.winner.naam));
  if (distinct.size === 1) {
    const { axis, winner } = orderingWinners[0];
    const hap =
      filters.length > 0
        ? composedHap(ranking, axis, filters, winner)
        : axisHap(ranking, axis, winner);
    return { winner, hap };
  }

  // Conflicting ordering axes. HEADLINE default: the price+accuracy pair resolves
  // to the composite value winner if the ranking carries one (ADR 0010), even
  // though the composite axis itself wasn't named.
  const isPricePlusAccuracy =
    orderingWinners.some((o) => isPriceAxis(o.axis)) &&
    orderingWinners.some((o) => isAccuracyAxis(o.axis)) &&
    orderingWinners.every((o) => isPriceAxis(o.axis) || isAccuracyAxis(o.axis));
  if (isPricePlusAccuracy && composite) {
    const compositeWinner = pickNumeric(pool, composite);
    if (compositeWinner) {
      // The default is a price-to-accuracy BALANCE, not one of the two conflicting
      // axes, so no `primary` axis. The composite axis is added to `axes` (by the
      // caller via `extraAxis`) so the balance winner is traceable too.
      const hap = tradeoffHap(ranking, orderingWinners, filters);
      return { winner: compositeWinner, hap, extraAxis: { key: composite.key, naam: compositeWinner.naam } };
    }
  }

  // No composite tiebreak: the PRIMARY axis is the one whose keyword appears
  // earliest in the query (orderingWinners is already sorted by query order); its
  // winner is the default. The hap states the trade-off naming each axis + winner
  // — never reframed to one axis (Bevinding ②).
  const primary = orderingWinners[0];
  const hap = tradeoffHap(ranking, orderingWinners, filters);
  return { winner: primary.winner, hap, primary: primary.axis.key };
}

// Filter-only hap when there is no ordering axis but one or more filters: names
// every filter constraint and the top-ranked provider that satisfies them all.
function composedHapFiltersOnly(
  ranking: CategorieRanking,
  filters: Beslisas[],
  winner: ProviderAanbod,
): string {
  const cat = ranking.label.toLowerCase();
  const filterLabels = filters.map((f) => f.label.toLowerCase()).join(" and ");
  const caveatList = filters.map((a) => a.caveat).filter((c): c is string => !!c);
  const uniqueCaveats = caveatList.filter((c, i) => caveatList.indexOf(c) === i);
  const caveat = uniqueCaveats.length > 0 ? `${uniqueCaveats.join(" ")} ` : "";
  return `For ${cat} with ${filterLabels}, ${winner.naam} (${winner.provider}) is the top-ranked option that supports it. ${caveat}${SOURCES_CAVEAT}`;
}

function build(
  ranking: CategorieRanking,
  query: string,
  winner: ProviderAanbod,
  axes: Record<string, string>,
  hap: string,
  primary?: string,
): AntwoordArtefact {
  return {
    query,
    slug: slugify(query),
    category: ranking.category,
    routing: "matched",
    hap,
    zekerheidslabel: ranking.zekerheidslabel,
    laatst_bijgewerkt: ranking.laatst_bijgewerkt,
    recommendation: primary ? { default: winner.naam, axes, primary } : { default: winner.naam, axes },
    providers: ranking.providers,
    bronnen: ranking.bronnen,
  };
}

/**
 * A well-typed NO-MATCH artefact (FIX 1): the query landed in no category
 * ("none") or was ambiguous between several ("ambiguous"), so there is NO
 * fabricated recommendation, no providers and no sources — that would be a
 * confident wrong-domain answer. Instead it carries a clear, jargon-free message
 * and the supported-category catalogue, so a machine (or human) can re-ask in
 * scope. The routing field lets consumers + telemetry tell this from a real
 * match. category is "" (no category resolved).
 */
export function noMatchArtefact(
  query: string,
  routing: Routing,
  categories: SupportedCategory[],
): AntwoordArtefact {
  const labels = categories.map((c) => c.label);
  const list =
    labels.length <= 1
      ? (labels[0] ?? "")
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  const hap =
    routing === "ambiguous"
      ? `That question could fit more than one of the tasks Syftly ranks (${list}). ` +
        `Tell me which one you mean — or re-ask with the specific task — and I'll give you the ranked picks with prices and sources.`
      : `Syftly doesn't rank tools for that task yet. It currently covers ${list}. ` +
        `Re-ask for one of those tasks and I'll return the ranked recommendation with prices, trade-offs and dated sources.`;
  return {
    query,
    slug: slugify(query),
    category: "",
    routing,
    hap,
    zekerheidslabel: "light estimate",
    laatst_bijgewerkt: new Date().toISOString().slice(0, 10),
    recommendation: { default: "", axes: {} },
    providers: [],
    bronnen: [],
    categories,
  };
}
