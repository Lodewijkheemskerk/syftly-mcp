import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProviderPricing, listProviderSlugs } from "@/lib/provider-pages";
import type { Prijs } from "@/lib/types";

type PageParams = { params: Promise<{ provider: string }> };

// Provider inventory is registry-derived and closed (no on-demand rendering).
export const dynamicParams = false;

export function generateStaticParams(): { provider: string }[] {
  return listProviderSlugs().map((provider) => ({ provider }));
}

function priceText(prijs: Prijs): string {
  if (prijs.waarde == null) return "No published per-unit price";
  return `$${prijs.waarde} ${prijs.eenheid.replace(/^\$\//, "per ")}`;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { provider } = await params;
  const pricing = getProviderPricing(provider);
  if (!pricing) return { title: "Syftly" };
  const title = `${pricing.provider} API pricing — Syftly`;
  const description =
    pricing.offerings
      .map((o) => `${o.aanbod.naam}: ${priceText(o.aanbod.prijs)} (${o.categoryLabel})`)
      .join("; ") + ". From dated public sources, honestly labeled.";
  return {
    title,
    description,
    alternates: { canonical: `/pricing/${provider}` },
    openGraph: { title, description, type: "article", url: `/pricing/${provider}` },
    twitter: { card: "summary" },
  };
}

export default async function Page({ params }: PageParams) {
  const { provider } = await params;
  const pricing = getProviderPricing(provider);
  if (!pricing) notFound();

  return (
    <main className="answer">
      <div className="answer-meta">
        <span className="trust-badge">
          <span className="trust-dot" />
          light estimate
        </span>
        <span className="meta-mono">Prices from dated public sources</span>
      </div>

      <h1>{pricing.provider} API pricing</h1>

      <p className="hap">
        {pricing.provider} has {pricing.offerings.length === 1 ? "one ranked offering" : `${pricing.offerings.length} ranked offerings`} on
        Syftly. Prices below are per-unit list prices from dated public sources — token- or
        credit-priced plans are flagged, and a missing price is shown as missing, never guessed.
      </p>

      {pricing.offerings.map((o) => (
        <section key={o.category}>
          <div className="section-label">
            <span>
              {o.aanbod.naam} · {o.categoryLabel}
            </span>
            <span className="rule" />
          </div>
          <div className="verdict">
            <span className="verdict-label">{o.categoryLabel} price</span>
            <span className="verdict-name">
              {priceText(o.aanbod.prijs)}
              {o.aanbod.prijs.vergelijkbaar === false ? " *" : ""}
            </span>
          </div>
          {o.aanbod.prijs.vergelijkbaar === false ? (
            <p className="table-note">
              <span className="fn-mark">*</span> token-/credit-priced — the headline understates
              real per-unit cost, so it is excluded from cheapest-rankings.
            </p>
          ) : null}
          {o.aanbod.prijs.waarde == null ? (
            <p className="table-note">{o.aanbod.zwak}</p>
          ) : null}
          <p className="table-note">
            Source: {o.aanbod.bron} <span className="src-date">{o.aanbod.bron_datum}</span> · ranking
            updated {o.laatst_bijgewerkt}
          </p>
          {o.cheapestAlt ? (
            <p className="table-note">
              Cheapest comparable {o.categoryLabel.toLowerCase()} alternative: {o.cheapestAlt.naam} (
              {priceText(o.cheapestAlt.prijs)}) —{" "}
              <a href={`/compare/${o.category}/${o.cheapestAlt.pair}`}>compare them</a>.
            </p>
          ) : null}
          <p className="table-note">
            Full ranking: <a href={`/categories`}>{o.categoryLabel}</a>
          </p>
        </section>
      ))}
    </main>
  );
}
