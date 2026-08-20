import type { Metadata } from "next";
import Link from "next/link";
import type { CategorieRanking } from "@/lib/types";
import { listCategories } from "@/lib/categories";
import { cheapest } from "@/lib/engine";

// Categories: the real categories Syftly covers, one card per registered
// category-ranking (ADR 0010 registry). Honest by construction — every figure
// comes from the ranking and there is no faked "coming soon" grid of empty
// categories (ADR 0009: depth is real aggregation, not a padded directory). The
// list grows by registering a ranking in lib/categories.ts, never by hand here.

export const metadata: Metadata = {
  title: "Categories — Syftly",
  description:
    "The categories Syftly covers — each a ranked list of provider offerings with sources, dates and a light-estimate confidence label. Depth is measured per category, not by the length of the list.",
};

export interface CategoryCard {
  category: string;
  label: string;
  offerings: number;
  queries: number;
  defaultPick: string;
  cheapest: string;
  updated: string;
  etalageHref: string;
  etalageQuery: string;
}

// One card view-model per ranking — pure, so the registry-driven listing is
// unit-testable without rendering. The first published query is the card's
// entry point; figures (offerings, cheapest) are computed from the ranking, so
// a new recept-run updates the card by itself.
export function categoryCards(rankings: CategorieRanking[]): CategoryCard[] {
  return rankings.map((r) => {
    const slugs = Object.keys(r.queries);
    const firstSlug = slugs[0];
    const view = firstSlug ? r.queries[firstSlug] : undefined;
    return {
      category: r.category,
      label: r.label,
      offerings: r.providers.length,
      queries: slugs.length,
      defaultPick: view?.recommendation.default ?? "—",
      cheapest: cheapest(r)?.naam ?? "—",
      updated: r.laatst_bijgewerkt,
      etalageHref: firstSlug ? `/${r.category}/${firstSlug}` : `/${r.category}`,
      etalageQuery: view?.query ?? "",
    };
  });
}

export default function Page() {
  const cards = categoryCards(listCategories());
  const n = cards.length;

  return (
    <main className="categories">
      <div className="answer-meta">
        <span className="trust-badge">
          <span className="trust-dot" />
          categories
        </span>
        <span className="meta-mono">
          {n} {n === 1 ? "category" : "categories"} · light estimate
        </span>
      </div>

      <h1>Categories</h1>
      <p className="hap">
        A category is a sub-task an agent buys an external tool for — transcription, scraping, voice,
        OCR, and so on. Depth is measured per category. Each card below is a real, end-to-end
        ranking; the rest grow as query-logs show demand, not before.
      </p>

      <div className="section-label">
        <span>Live categories</span>
        <span className="rule" />
      </div>

      {cards.map((c) => (
        <Link href={c.etalageHref} className="cat-card" key={c.category}>
          <div className="cat-card-head">
            <span className="cat-name">{c.label}</span>
            <span className="cat-confidence">light estimate</span>
          </div>
          <ul className="cat-facts">
            <li>
              <b>{c.offerings}</b> provider offerings
            </li>
            <li>
              <b>{c.queries}</b> published {c.queries === 1 ? "query" : "queries"}
            </li>
            <li>
              Default: <b>{c.defaultPick}</b>
            </li>
            <li>
              Cheapest: <b>{c.cheapest}</b>
            </li>
            <li>Updated {c.updated}</li>
          </ul>
          <div className="cat-cta">
            {c.etalageQuery ? `See: ${c.etalageQuery} →` : "See the ranking →"}
          </div>
        </Link>
      ))}

      <p className="cat-note">
        &ldquo;Deeper&rdquo; means richer aggregation, a wider query-set and a freshness heartbeat —
        never a longer list of empty categories.
      </p>
    </main>
  );
}
