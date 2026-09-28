import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  canonicalPair,
  getComparison,
  listComparePairs,
  providerDisplay,
} from "@/lib/provider-pages";

type PageParams = { params: Promise<{ category: string; pair: string }> };

// The pair inventory is registry-derived; canonical pairs prerender. Unknown
// params MUST still reach the page code (dynamicParams default), because a
// reversed pair earns a 308 to its canonical URL — with dynamicParams=false the
// router would 404 before the redirect can run. Anything that is neither
// canonical nor reversible still 404s below, so no crafted URL renders content.
export function generateStaticParams(): { category: string; pair: string }[] {
  return listComparePairs();
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { category, pair } = await params;
  const cmp = getComparison(category, pair);
  if (!cmp) return { title: "Syftly" };
  const title = `${providerDisplay(cmp.a.provider)} vs ${providerDisplay(cmp.b.provider)}: ${cmp.ranking.label} API comparison — Syftly`;
  return {
    title,
    description: cmp.summary,
    alternates: { canonical: `/compare/${category}/${pair}` },
    openGraph: { title, description: cmp.summary, type: "article", url: `/compare/${category}/${pair}` },
    twitter: { card: "summary" },
  };
}

// Two-item schema.org ItemList: same shape as the answer pages, restricted to
// the compared offerings, position = ranking order.
function compareJsonLd(cmp: NonNullable<ReturnType<typeof getComparison>>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${providerDisplay(cmp.a.provider)} vs ${providerDisplay(cmp.b.provider)} (${cmp.ranking.label})`,
    dateModified: cmp.ranking.laatst_bijgewerkt,
    itemListElement: [cmp.a, cmp.b].map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.naam,
      item: { "@type": "Product", name: p.naam, brand: p.provider },
    })),
  };
}

export default async function Page({ params }: PageParams) {
  const { category, pair } = await params;
  const cmp = getComparison(category, pair);
  if (!cmp) {
    // A valid pair in the wrong direction gets one canonical URL (308), so the
    // two spellings can never compete in an index; anything else is a real 404.
    const canon = canonicalPair(category, pair);
    if (canon) permanentRedirect(`/compare/${category}/${canon}`);
    notFound();
  }

  const aName = providerDisplay(cmp.a.provider);
  const bName = providerDisplay(cmp.b.provider);
  const nonComparable = [cmp.a, cmp.b].some((p) => p.prijs.vergelijkbaar === false);

  return (
    <main className="answer">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(compareJsonLd(cmp)).replace(/</g, "\\u003c"),
        }}
      />
      <div className="answer-meta">
        <span className="trust-badge">
          <span className="trust-dot" />
          {cmp.ranking.zekerheidslabel}
        </span>
        <span className="meta-mono">Last updated {cmp.ranking.laatst_bijgewerkt}</span>
      </div>

      <h1>
        {aName} vs {bName}
      </h1>

      <p className="hap">{cmp.summary}</p>

      <div className="section-label">
        <span>Head to head</span>
        <span className="rule" />
      </div>
      <div className="ptable-wrap">
        <table className="ptable">
          <caption className="sr-only">
            {cmp.a.naam} compared with {cmp.b.naam} per decision axis
          </caption>
          <thead>
            <tr>
              <th>Axis</th>
              <th className="num">{cmp.a.naam}</th>
              <th className="num">{cmp.b.naam}</th>
              <th>Edge</th>
            </tr>
          </thead>
          <tbody>
            {cmp.verdicts.map((v) => (
              <tr key={v.axis.key}>
                <td className="offering">{v.axis.kolom}</td>
                <td className="num">
                  {v.va}
                  {v.axis.metric === "prijs" && cmp.a.prijs.vergelijkbaar === false ? (
                    <span className="fn-mark">*</span>
                  ) : null}
                </td>
                <td className="num">
                  {v.vb}
                  {v.axis.metric === "prijs" && cmp.b.prijs.vergelijkbaar === false ? (
                    <span className="fn-mark">*</span>
                  ) : null}
                </td>
                <td>{v.winner === null ? "—" : v.winner === "a" ? aName : bName}</td>
              </tr>
            ))}
            {cmp.badges.map((b) => (
              <tr key={b.axis.key}>
                <td className="offering">{b.axis.kolom}</td>
                <td className="num">{b.a ? "✓" : "—"}</td>
                <td className="num">{b.b ? "✓" : "—"}</td>
                <td>—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nonComparable ? (
        <p className="table-note">
          <span className="fn-mark">*</span> token-/credit-priced — the headline understates real
          per-unit cost, so no price edge is awarded.
        </p>
      ) : null}

      <div className="section-label">
        <span>Strengths &amp; caveats</span>
        <span className="rule" />
      </div>
      <div className="rec-row">
        <span className="chip">
          <span className="chip-label">{aName}</span>
          {cmp.a.sterk} {cmp.a.zwak}
        </span>
        <span className="chip">
          <span className="chip-label">{bName}</span>
          {cmp.b.sterk} {cmp.b.zwak}
        </span>
      </div>

      <div className="section-label">
        <span>Sources</span>
        <span className="rule" />
      </div>
      <ul className="sources">
        {cmp.ranking.bronnen.map((b) => (
          <li key={b.url}>
            <a href={b.url}>{b.titel}</a>
            <span className="src-date">{b.datum}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
