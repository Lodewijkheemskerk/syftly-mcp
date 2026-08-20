import type { MetadataRoute } from "next";
import { canonical } from "@/lib/site";
import { listEtalage } from "@/lib/artefact";
import { listComparePairs, listProviderSlugs } from "@/lib/provider-pages";

// The static answer-first pages: the indexable hub of the site (ADR 0002/0009).
const STATIC_PAGES = ["/", "/categories", "/methodology", "/for-agents"];

// The crawl manifest of the *indexable* surface only: the static pages plus the
// curated etalage queries from the registry. The engine long-tail is left out on
// purpose — those pages carry a noindex meta, and listing them would breed the
// doorway/scaled-content pages ADR 0009 forbids. Registry-derived, so it can't
// drift out of sync with what actually exists.
export default function sitemap(): MetadataRoute.Sitemap {
  const staticUrls = STATIC_PAGES.map((path) => ({ url: canonical(path) }));
  const etalageUrls = listEtalage().map(({ category, query }) => ({
    url: canonical(`/${category}/${query}`),
  }));
  // Compare + pricing pages: registry-derived and statically generated with a
  // closed inventory (dynamicParams=false), so listing them here cannot drift.
  const compareUrls = listComparePairs().map(({ category, pair }) => ({
    url: canonical(`/compare/${category}/${pair}`),
  }));
  const pricingUrls = listProviderSlugs().map((slug) => ({
    url: canonical(`/pricing/${slug}`),
  }));
  return [...staticUrls, ...etalageUrls, ...compareUrls, ...pricingUrls];
}
