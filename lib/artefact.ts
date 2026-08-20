import type { AntwoordArtefact, CategorieRanking } from "@/lib/types";
import { slugify, deslugify } from "@/lib/slug";
import {
  getRanking,
  listCategories,
  matchCategories,
  routeCategory,
  supportedCategories,
} from "@/lib/categories";
import { projectArtefact } from "@/lib/ranking";
import { answerQuery, matchesAxis, noMatchArtefact } from "@/lib/engine";

// An Antwoord-artefact is a projection of a Categorie-ranking for one query
// (ADR 0002/0005). These thin wrappers are category-aware (ADR 0010): the page
// knows its category from the URL segment, the endpoints detect it from the
// query. The source of truth is the registry (lib/categories.ts).

/**
 * Look up the published (etalage) artefact for a (category, slug), or null if not
 * published / unknown category. Published-only on purpose: this drives static
 * generation of the crawlable, indexable pages (ADR 0009 AEO-guardrail).
 */
export function getArtefact(category: string, slug: string): AntwoordArtefact | null {
  const ranking = getRanking(category);
  return ranking ? projectArtefact(ranking, slug) : null;
}

// Paraphrase match against the category's published etalage entries. Agents
// rarely repeat a published query verbatim ("…for IVR phone system" vs the
// published "…for IVR and phone agents"), and the slug-exact-or-engine flow
// served those paraphrases the generic category default instead of the curated
// answer. Deterministic token overlap, no NLP: an entry's distinctive tokens are
// its query words minus scaffolding words and the category's own name; the entry
// with the highest hit COVERAGE (hits / distinctive tokens) wins, and a strict
// tie falls through to the engine — ambiguity is the engine's job, not a guess.
const SCAFFOLDING = new Set([
  "best", "cheapest", "most", "api", "tool", "for", "with", "and", "the", "a", "an", "of", "in", "to", "on", "or",
]);

// Light plural fold ("podcasts" ↔ "podcast") so a singular/plural mismatch
// doesn't miss; anything smarter (stemming) buys ambiguity, not recall.
function foldToken(t: string): string {
  return t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(foldToken);
}

function matchPublished(ranking: CategorieRanking, query: string): AntwoordArtefact | null {
  const categoryStop = new Set([...tokenize(ranking.label), ...tokenize(ranking.category)]);
  const queryTokens = new Set(tokenize(query));
  let best: { slug: string; coverage: number } | null = null;
  let tied = false;
  for (const [slug, view] of Object.entries(ranking.queries)) {
    const distinctive = tokenize(view.query).filter(
      (t) => !SCAFFOLDING.has(t) && !categoryStop.has(t),
    );
    if (distinctive.length === 0) continue; // only exact-slug can reach this entry
    const hits = distinctive.filter((t) => queryTokens.has(t)).length;
    if (hits === 0) continue;
    const coverage = hits / distinctive.length;
    if (!best || coverage > best.coverage) {
      best = { slug, coverage };
      tied = false;
    } else if (coverage === best.coverage) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  return projectArtefact(ranking, best.slug);
}

/**
 * Look up the Antwoord-artefact for a human query (the machine-endpoint path).
 *
 * Routing is HONEST (FIX 1): an explicit category wins; otherwise the query is
 * routed via routeCategory, which never fabricates a default. A matched query is
 * answered from its category — the curated etalage artefact if published, else a
 * live engine answer (ADR 0009), so an in-category question never 404s. A query
 * that matches NO category (gibberish / out-of-scope) or is AMBIGUOUS between
 * categories returns a no-match artefact (routing "none"/"ambiguous") carrying
 * the supported catalogue — NOT a silent transcription answer. Null only for an
 * empty query or an unknown explicit category.
 */
export function getArtefactByQuery(query: string, category?: string): AntwoordArtefact | null {
  if (query.trim().length === 0) return null;

  if (category !== undefined) {
    // An explicit category wins over detection (ADR 0010 point 3). Unknown =
    // null (the caller reports a tool/HTTP error); known = a real answer.
    const ranking = getRanking(category);
    if (!ranking) return null;
    return (
      projectArtefact(ranking, slugify(query)) ??
      matchPublished(ranking, query) ??
      answerQuery(ranking, query)
    );
  }

  const route = routeCategory(query);
  if (route.routing !== "matched" || route.category === null) {
    return noMatchArtefact(query, route.routing, route.categories);
  }
  const ranking = getRanking(route.category);
  // routeCategory only ever returns a registered category, but guard anyway.
  if (!ranking) return noMatchArtefact(query, "none", supportedCategories());
  return (
      projectArtefact(ranking, slugify(query)) ??
      matchPublished(ranking, query) ??
      answerQuery(ranking, query)
    );
}

/**
 * Resolve a page (category, slug) to an artefact plus whether it is the curated
 * etalage (ADR 0009). `etalage: true` = a published, indexable page; `false` = a
 * live engine answer for a long-tail in-category query, which the page marks
 * `noindex` (index the few, serve the tail without indexing).
 *
 * Long-tail gate: the slug is an attacker-writable URL string, so an unpublished
 * slug only earns an engine answer when the de-slugged question shows a real
 * signal for THIS category — an axis keyword ("cheapest", "most accurate", …) or
 * a category keyword ("transcribe", …). With neither, the artefact is null and
 * the page 404s: ADR 0009's "an in-category question never 404s" still holds,
 * because a string with no signal is not an in-category question — serving it
 * would put a confident "Default pick" under any URL someone crafts.
 */
export function resolveBySlug(
  category: string,
  slug: string,
): { artefact: AntwoordArtefact | null; etalage: boolean } {
  const ranking = getRanking(category);
  if (!ranking) return { artefact: null, etalage: false };
  const published = projectArtefact(ranking, slug);
  if (published) return { artefact: published, etalage: true };
  const query = deslugify(slug);
  const inCategory = matchesAxis(ranking, query) || matchCategories(query).includes(category);
  return { artefact: inCategory ? answerQuery(ranking, query) : null, etalage: false };
}

/**
 * Every published (category, slug) pair across all categories — drives static
 * generation of the /[category]/[query] pages.
 */
export function listEtalage(): Array<{ category: string; query: string }> {
  return listCategories().flatMap((r) =>
    Object.keys(r.queries).map((slug) => ({ category: r.category, query: slug })),
  );
}
