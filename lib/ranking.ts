import type { AntwoordArtefact, CategorieRanking } from "@/lib/types";
import { getRanking as getCategoryRanking, DEFAULT_CATEGORY } from "@/lib/categories";

// The Categorie-ranking is the knowledge atom (ADR 0002/0005). Single-category
// helpers project the DEFAULT category (transcription) — the multi-category
// registry lives in lib/categories.ts (ADR 0010); these thin wrappers keep the
// existing single-category callers (the [query] page, the keystone tests)
// working while routing/endpoints migrate to be category-aware (A3).

/** The default category-ranking that single-category callers project from. */
export function getRanking(): CategorieRanking {
  return getCategoryRanking(DEFAULT_CATEGORY)!;
}

/**
 * Project the Categorie-ranking into an Antwoord-artefact for one published
 * query slug — the artefact is a view on the ranking (ADR 0002). Shared facts
 * (providers, bronnen, freshness, label) come from the ranking; the query, hap
 * and recommendation come from that slug's view. Returns null when no published
 * view exists for the slug.
 */
export function projectArtefact(
  ranking: CategorieRanking,
  slug: string,
): AntwoordArtefact | null {
  const view = ranking.queries[slug];
  if (!view) return null;

  return {
    query: view.query,
    slug,
    category: ranking.category,
    // A published etalage artefact is, by definition, a real category match.
    routing: "matched",
    hap: view.hap,
    zekerheidslabel: ranking.zekerheidslabel,
    laatst_bijgewerkt: ranking.laatst_bijgewerkt,
    recommendation: view.recommendation,
    providers: ranking.providers,
    bronnen: ranking.bronnen,
  };
}

/** Slugs with a published view — drives static generation of the pages. */
export function listPublishedSlugs(): string[] {
  return Object.keys(getRanking().queries);
}
