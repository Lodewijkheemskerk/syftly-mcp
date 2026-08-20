import type { Metadata } from "next";
import Link from "next/link";
import type { CategorieRanking } from "@/lib/types";
import { listCategories } from "@/lib/categories";

// The landing page / (L2): Syftly's human entry point and crawl-hub. Answer-first
// in the homepage sense — it leads with what the product is (H1 + hap), then opens
// a rich internal-link surface into every category and a featured real etalage
// query per category, so answer-engines discover the AEO pages (the actual
// citation targets) and a human is oriented in one screen. Every figure and link
// is derived from the registry (ADR 0010) — no hard-coded list, so it can never
// drift into dead links or a faked "coming soon" grid (ADR 0009).

export const metadata: Metadata = {
  title: "Syftly — the decision layer for the tools AI agents buy",
  description:
    "Syftly ranks the best, cheapest and most reliable API per task — transcription, text-to-speech, web search, scraping, OCR — aggregated from public benchmarks with sources and dates. A light estimate, for humans and agents.",
};

export interface HomeCategory {
  category: string;
  label: string;
  offerings: number;
  queries: number;
  href: string; // entry point: the first published etalage query, else the segment
}

export interface FeaturedAnswer {
  category: string;
  query: string; // the human question, as published
  href: string;
}

export interface HomeModel {
  categories: HomeCategory[];
  featured: FeaturedAnswer[];
  totals: { categories: number; offerings: number; queries: number };
}

// Pure, registry-driven view-model — unit-testable without rendering. The card's
// entry point and the featured answer both use a category's first published query,
// so a new recept-run (more queries/offerings) updates the hub by itself and the
// links can never point at an unpublished (404) page.
export function homeModel(rankings: CategorieRanking[]): HomeModel {
  const categories: HomeCategory[] = rankings.map((r) => {
    const firstSlug = Object.keys(r.queries)[0];
    return {
      category: r.category,
      label: r.label,
      offerings: r.providers.length,
      queries: Object.keys(r.queries).length,
      href: firstSlug ? `/${r.category}/${firstSlug}` : `/${r.category}`,
    };
  });

  const featured: FeaturedAnswer[] = rankings.flatMap((r) => {
    const firstSlug = Object.keys(r.queries)[0];
    if (!firstSlug) return [];
    return [{ category: r.category, query: r.queries[firstSlug].query, href: `/${r.category}/${firstSlug}` }];
  });

  const totals = {
    categories: rankings.length,
    offerings: rankings.reduce((n, r) => n + r.providers.length, 0),
    queries: rankings.reduce((n, r) => n + Object.keys(r.queries).length, 0),
  };

  return { categories, featured, totals };
}

export default function Page() {
  const { categories, featured, totals } = homeModel(listCategories());

  return (
    <main className="home">
      <div className="answer-meta">
        <span className="trust-badge">
          <span className="trust-dot" />
          evaluation layer
        </span>
        <span className="meta-mono">
          {totals.categories} categories · {totals.offerings} provider offerings · light estimate
        </span>
      </div>

      <h1>The decision layer for the tools AI agents buy</h1>
      <p className="hap">
        Syftly tells an AI agent which API to call for a task — the best, cheapest and most reliable
        offering per category — aggregated from public benchmarks with sources and dates, refreshed
        monthly. A light estimate, never sold as hard-tested. One answer, three ways: page, JSON, MCP.
      </p>

      <div className="section-label">
        <span>Categories</span>
        <span className="rule" />
      </div>
      <div className="home-cats">
        {categories.map((c) => (
          <Link key={c.category} href={c.href} className="home-cat">
            <span className="home-cat-name">{c.label}</span>
            <span className="home-cat-facts">
              {c.offerings} offerings · {c.queries} {c.queries === 1 ? "query" : "queries"}
            </span>
          </Link>
        ))}
      </div>
      <p className="home-more">
        <Link href="/categories">Browse all categories →</Link>
      </p>

      <div className="section-label">
        <span>Featured answers</span>
        <span className="rule" />
      </div>
      <ul className="featured">
        {featured.map((f) => (
          <li key={f.href}>
            <Link href={f.href}>
              {f.query}
              <span className="featured-arrow">→</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="section-label">
        <span>For agents</span>
        <span className="rule" />
      </div>
      <p className="home-agents">
        Every answer is callable: one MCP tool (<code className="inline">find_best_tool</code>), plus
        JSON and Markdown over a single endpoint.{" "}
        <Link href="/for-agents">See how agents consume Syftly →</Link>
      </p>

      <p className="home-foot">
        Independent rankings, computed from structured provider fields — not editorial picks.{" "}
        <Link href="/methodology">How we rank →</Link>
      </p>
    </main>
  );
}
