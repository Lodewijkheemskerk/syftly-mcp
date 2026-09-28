import type { Beslisas, CategorieRanking, Prijs, ProviderAanbod } from "@/lib/types";
import { getRanking, listCategories, routeCategory } from "@/lib/categories";
import { cheapest, PRIJS_METRIC } from "@/lib/engine";
import { slugify } from "@/lib/slug";

// Projections of the Categorie-rankings for the compare ("X vs Y") and provider
// pricing pages. Same honesty rules as the answer surface (ADR 0009): winners
// are computed with the engine's semantics (comparable prices only, null = no
// data, never a fabricated number), and the page inventory is derived from the
// registry so it cannot drift from the data.

// "Tavily (acquired by Nebius, Feb 2026)" -> "Tavily"; "SerpApi LLC" -> "SerpApi".
function cleanProvider(provider: string): string {
  return provider
    .replace(/\s*\(.*?\)/g, "")
    .replace(/[,\s]+(LLC|Inc\.?|Ltd\.?)$/i, "")
    .trim();
}

/** Company name as shown in an H1: original casing, minus legal/parenthetical noise. */
export function providerDisplay(provider: string): string {
  return cleanProvider(provider);
}

/** URL slug for a provider (company) name. */
export function providerSlug(provider: string): string {
  return slugify(cleanProvider(provider));
}

// Unique providers of a ranking in ranking order; first offer wins on a
// duplicate slug (does not occur in today's data, but cheap to guarantee).
function uniqueProviders(ranking: CategorieRanking): { slug: string; aanbod: ProviderAanbod }[] {
  const seen = new Set<string>();
  const out: { slug: string; aanbod: ProviderAanbod }[] = [];
  for (const p of ranking.providers) {
    const slug = providerSlug(p.provider);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, aanbod: p });
  }
  return out;
}

/** Every canonical in-category provider pair — drives static generation. The
 * canonical direction is ranking order: the higher-ranked provider comes first. */
export function listComparePairs(): { category: string; pair: string }[] {
  return listCategories().flatMap((ranking) => {
    const provs = uniqueProviders(ranking);
    const pairs: { category: string; pair: string }[] = [];
    for (let i = 0; i < provs.length; i++) {
      for (let j = i + 1; j < provs.length; j++) {
        pairs.push({ category: ranking.category, pair: `${provs[i].slug}-vs-${provs[j].slug}` });
      }
    }
    return pairs;
  });
}

export interface Verdict {
  axis: Beslisas;
  va: string; // side A's value with unit, "—" when absent
  vb: string;
  winner: "a" | "b" | null; // null = tie or missing data — never a guess
}

export interface Comparison {
  ranking: CategorieRanking;
  a: ProviderAanbod;
  b: ProviderAanbod;
  verdicts: Verdict[]; // numeric display axes, price first (mirrors the table)
  badges: { axis: Beslisas; a: boolean; b: boolean }[]; // capability axes
  summary: string; // computed prose — doubles as the meta description
}

// Numeric value under engine semantics: the price sentinel reads prijs.waarde
// and treats a non-comparable (token-/credit-priced) offer as no-data for the
// axis, exactly like lib/engine's numericPool does (ADR 0009).
function axisValue(p: ProviderAanbod, axis: Beslisas): number | null {
  if (axis.metric === PRIJS_METRIC) {
    return p.prijs.vergelijkbaar === false ? null : p.prijs.waarde;
  }
  const v = p.metrics?.[axis.metric];
  return typeof v === "number" ? v : null;
}

function axisText(p: ProviderAanbod, axis: Beslisas): string {
  if (axis.metric === PRIJS_METRIC) {
    return p.prijs.waarde == null ? "—" : `$${p.prijs.waarde} ${p.prijs.eenheid.replace(/^\$\//, "per ")}`;
  }
  const v = axisValue(p, axis);
  return v == null ? "—" : `${v}${axis.eenheid ?? ""}`;
}

// The numeric axes the compare renders: display axes only (those with a
// `kolom`), price first — the same selection rule as the answer-page table.
function numericAxes(ranking: CategorieRanking): Beslisas[] {
  const shown = ranking.assen.filter((a) => a.kolom && a.richting !== "filter");
  return [
    ...shown.filter((a) => a.metric === PRIJS_METRIC),
    ...shown.filter((a) => a.metric !== PRIJS_METRIC),
  ];
}

function compareSummary(ranking: CategorieRanking, a: ProviderAanbod, b: ProviderAanbod, verdicts: Verdict[]): string {
  const phrases = verdicts
    .filter((v) => v.winner !== null)
    .slice(0, 3)
    .map((v) => {
      const w = v.winner === "a" ? a : b;
      return `${v.axis.kolom}: ${v.va} vs ${v.vb} — edge ${providerDisplay(w.provider)}.`;
    });
  const head = `${a.naam} vs ${b.naam} for ${ranking.label.toLowerCase()}.`;
  const tail = `Computed from public benchmarks with dated sources; updated ${ranking.laatst_bijgewerkt}.`;
  return [head, ...phrases, tail].join(" ");
}

/** The comparison for a canonical (category, pair) — null for anything else:
 * unknown category/provider, a self-compare, or a reversed (non-canonical) pair. */
export function getComparison(category: string, pair: string): Comparison | null {
  const ranking = getRanking(category);
  if (!ranking) return null;
  const parts = pair.split("-vs-");
  if (parts.length !== 2 || parts[0] === parts[1]) return null;
  const provs = uniqueProviders(ranking);
  const ia = provs.findIndex((p) => p.slug === parts[0]);
  const ib = provs.findIndex((p) => p.slug === parts[1]);
  if (ia < 0 || ib < 0 || ia >= ib) return null; // ia > ib = reversed → canonicalPair

  const a = provs[ia].aanbod;
  const b = provs[ib].aanbod;
  const verdicts: Verdict[] = numericAxes(ranking).map((axis) => {
    const na = axisValue(a, axis);
    const nb = axisValue(b, axis);
    let winner: "a" | "b" | null = null;
    if (na != null && nb != null && na !== nb) {
      const aBetter = axis.richting === "max" ? na > nb : na < nb;
      winner = aBetter ? "a" : "b";
    }
    return { axis, va: axisText(a, axis), vb: axisText(b, axis), winner };
  });
  const badges = ranking.assen
    .filter((x) => x.kolom && x.richting === "filter")
    .map((axis) => ({
      axis,
      a: a.metrics?.[axis.metric] === true,
      b: b.metrics?.[axis.metric] === true,
    }));

  return { ranking, a, b, verdicts, badges, summary: compareSummary(ranking, a, b, verdicts) };
}

/** The canonical pair slug when `pair` is a valid pair in the WRONG direction
 * (so the page can 308-redirect), null when `pair` is canonical or unknown. */
export function canonicalPair(category: string, pair: string): string | null {
  const parts = pair.split("-vs-");
  if (parts.length !== 2) return null;
  const reversed = `${parts[1]}-vs-${parts[0]}`;
  return getComparison(category, reversed) ? reversed : null;
}

export interface PricingOffering {
  category: string;
  categoryLabel: string;
  laatst_bijgewerkt: string;
  aanbod: ProviderAanbod;
  // The cheapest comparable in-category offer from ANOTHER provider, with the
  // canonical compare-pair slug for interlinking. Null when this provider is
  // itself the cheapest (or nothing comparable exists).
  cheapestAlt: { naam: string; provider: string; prijs: Prijs; pair: string } | null;
}

export interface ProviderPricing {
  provider: string; // display name
  slug: string;
  offerings: PricingOffering[];
}

/** All of one provider's offerings across categories, or null if unknown. */
export function getProviderPricing(slug: string): ProviderPricing | null {
  const offerings: PricingOffering[] = [];
  let display: string | null = null;
  for (const ranking of listCategories()) {
    const provs = uniqueProviders(ranking);
    const own = provs.find((p) => p.slug === slug);
    if (!own) continue;
    display ??= providerDisplay(own.aanbod.provider);
    const alt = cheapest(ranking);
    const altSlug = alt ? providerSlug(alt.provider) : null;
    let cheapestAlt: PricingOffering["cheapestAlt"] = null;
    if (alt && altSlug && altSlug !== slug) {
      const io = provs.findIndex((p) => p.slug === slug);
      const ic = provs.findIndex((p) => p.slug === altSlug);
      const pair = io < ic ? `${slug}-vs-${altSlug}` : `${altSlug}-vs-${slug}`;
      cheapestAlt = { naam: alt.naam, provider: providerDisplay(alt.provider), prijs: alt.prijs, pair };
    }
    offerings.push({
      category: ranking.category,
      categoryLabel: ranking.label,
      laatst_bijgewerkt: ranking.laatst_bijgewerkt,
      aanbod: own.aanbod,
      cheapestAlt,
    });
  }
  if (!display || offerings.length === 0) return null;
  return { provider: display, slug, offerings };
}

/** Every provider slug across all categories — drives static generation. */
export function listProviderSlugs(): string[] {
  const slugs = new Set<string>();
  for (const ranking of listCategories()) {
    for (const { slug } of uniqueProviders(ranking)) slugs.add(slug);
  }
  return [...slugs];
}

// Words an agent uses for a provider: the company slug ("bright-data") plus the
// first word of the product name ("aws" for "AWS Textract", "azure" for "Azure
// Document Intelligence"). "web" (Bright Data's "Web Unlocker") is too generic.
const GENERIC_ALIASES = new Set(["web"]);
function aliases(p: ProviderAanbod): string[] {
  const first = slugify(p.naam).split("-")[0];
  return [providerSlug(p.provider), ...(first && !GENERIC_ALIASES.has(first) ? [first] : [])];
}

// Canonical pair when the query names EXACTLY two providers of the category;
// one provider or three+ is a ranking question, not a head-to-head.
function pairIn(ranking: CategorieRanking, query: string): string | null {
  const q = `-${slugify(query)}-`;
  const named = uniqueProviders(ranking).filter(({ aanbod }) =>
    aliases(aanbod).some((a) => q.includes(`-${a}-`)),
  );
  return named.length === 2 ? `${named[0].slug}-vs-${named[1].slug}` : null;
}

/**
 * The head-to-head a query asks for ("Cartesia vs ElevenLabs for narration"), as
 * a canonical compare pair, or null. The explicit or detected category decides
 * where to look; without one, the pair must be unambiguous across categories.
 */
export function findComparison(query: string, category?: string): { category: string; pair: string } | null {
  const route = routeCategory(query);
  const scope = category ?? (route.routing === "matched" ? route.category : null);
  const rankings = scope ? [getRanking(scope)].filter((r) => r !== null) : listCategories();
  const hits = rankings.flatMap((r) => {
    const pair = pairIn(r, query);
    return pair ? [{ category: r.category, pair }] : [];
  });
  return hits.length === 1 ? hits[0] : null;
}
