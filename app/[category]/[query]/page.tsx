import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveBySlug, listEtalage } from "@/lib/artefact";
import { getRanking } from "@/lib/categories";
import { PRIJS_METRIC } from "@/lib/engine";
import type { Beslisas, ProviderAanbod } from "@/lib/types";

type PageParams = { params: Promise<{ category: string; query: string }> };

// Render an axis slug ("laagste-latency-realtime") as a human label.
function axisLabel(slug: string): string {
  return slug.replace(/-/g, " ");
}

// Typed reads of the open metrics map (ADR 0010): a number metric or null, and a
// boolean trait. Keeps the transcription table type-safe over Record values.
function num(p: ProviderAanbod, key: string): number | null {
  const v = p.metrics?.[key];
  return typeof v === "number" ? v : null;
}
function flag(p: ProviderAanbod, key: string): boolean {
  return p.metrics?.[key] === true;
}

// Which axes the provider-table renders, derived from the category's `assen`
// (ADR 0010): an axis appears IFF it declares a `kolom`. Numeric axes (min/max)
// become value columns — the price sentinel first, then config order — and
// filter axes become capability badges. Axes without a `kolom` (a composite
// score, or a language filter already covered by the language-count column) stay
// routing-only and out of the table. One codepath for all five focus categories.
export function tableColumns(assen: Beslisas[]): { numeric: Beslisas[]; badges: Beslisas[] } {
  const shown = assen.filter((a) => a.kolom);
  const numeric = shown.filter((a) => a.richting !== "filter");
  return {
    numeric: [
      ...numeric.filter((a) => a.metric === PRIJS_METRIC),
      ...numeric.filter((a) => a.metric !== PRIJS_METRIC),
    ],
    badges: shown.filter((a) => a.richting === "filter"),
  };
}

// A numeric column header: the price sentinel carries its unit (its values are
// bare numbers); other axes keep the unit on the value, so their header is bare.
function columnHeader(axis: Beslisas, priceUnit: string): string {
  return axis.metric === PRIJS_METRIC ? `${axis.kolom} (${priceUnit})` : (axis.kolom ?? "");
}

// A numeric cell value: the price sentinel reads prijs.waarde; any other axis
// reads its metric and appends the axis unit. A missing number is an honest "—".
function numericCell(p: ProviderAanbod, axis: Beslisas): string {
  const v = axis.metric === PRIJS_METRIC ? p.prijs.waarde : num(p, axis.metric);
  return v == null ? "—" : `${v}${axis.eenheid ?? ""}`;
}

// Statically generate one page per published (category, slug) — crawlable = SEO
// hygiene, the precondition for AEO (ADR 0002).
export function generateStaticParams(): { category: string; query: string }[] {
  return listEtalage();
}

// The hap doubles as the meta description (the citeerbare snippet — ADR 0002).
// Only the curated etalage is indexable; engine-rendered long-tail pages are
// noindex (ADR 0009 AEO-guardrail) — index the few, serve the tail unindexed.
export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { category, query } = await params;
  const { artefact, etalage } = resolveBySlug(category, query);
  if (!artefact) return { title: "Syftly" };
  const title = `${artefact.query} — Syftly`;
  return {
    title,
    description: artefact.hap,
    robots: etalage ? undefined : { index: false, follow: true },
    // Canonical only on the curated etalage: the engine long-tail is noindex,
    // and giving it canonicals would promote pages ADR 0009 keeps unindexed.
    // Relative paths resolve against metadataBase (layout.tsx).
    alternates: etalage ? { canonical: `/${category}/${query}` } : undefined,
    openGraph: {
      title,
      description: artefact.hap,
      type: "article",
      url: `/${category}/${query}`,
    },
    twitter: { card: "summary" },
  };
}

// The ranking as schema.org ItemList: the same honest data the table renders,
// machine-parseable for answer engines. Position = ranking order (ADR 0009:
// the order IS the judgment, so it must survive into the structured data).
export function answerJsonLd(artefact: {
  query: string;
  laatst_bijgewerkt: string;
  providers: { naam: string; provider: string }[];
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: artefact.query,
    dateModified: artefact.laatst_bijgewerkt,
    itemListElement: artefact.providers.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.naam,
      item: { "@type": "Product", name: p.naam, brand: p.provider },
    })),
  };
}

export default async function Page({ params }: PageParams) {
  const { category, query } = await params;
  const { artefact } = resolveBySlug(category, query);

  // No artefact = unknown category OR a slug with no in-category signal (the
  // long-tail gate in resolveBySlug). A real 404 — not a soft-200 empty state —
  // so crafted URLs can't render anything under Syftly branding.
  if (!artefact) notFound();

  // Table columns are config-driven (ADR 0010): derived from this category's own
  // decision-axes, not hard-coded transcription fields.
  const assen = getRanking(artefact.category)?.assen ?? [];
  const { numeric, badges } = tableColumns(assen);
  const priceUnit = artefact.providers[0]?.prijs.eenheid ?? "";
  const comparedOn = numeric.map((a) => a.kolom).join(", ");

  return (
    <main className="answer">
      {/* JSON-LD for answer engines. JSON.stringify output is safe except a
          literal "</script>" inside strings — escaping "<" closes that hole. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(answerJsonLd(artefact)).replace(/</g, "\\u003c"),
        }}
      />
      {/* Answer-first: trust + freshness, then question as H1, then the hap. */}
      <div className="answer-meta">
        <span className="trust-badge">
          <span className="trust-dot" />
          {artefact.zekerheidslabel}
        </span>
        <span className="meta-mono">Last updated {artefact.laatst_bijgewerkt}</span>
      </div>

      <h1>{artefact.query}</h1>

      {/* Verdict: the default winner promoted above the prose (machine-truth →
          mono), so a skimming human gets the answer before reading the hap. Only
          shown when there is a real recommendation (not a no-match artefact). */}
      {artefact.recommendation.default ? (
        <div className="verdict">
          <span className="verdict-label">Default pick</span>
          <span className="verdict-name">{artefact.recommendation.default}</span>
        </div>
      ) : null}

      <p className="hap">{artefact.hap}</p>

      <div className="rec-row">
        <span className="chip chip--default">
          <span className="chip-label">Default</span>
          {artefact.recommendation.default}
        </span>
        {Object.entries(artefact.recommendation.axes).map(([as, naam]) => (
          <span className="chip" key={as}>
            <span className="chip-label">{axisLabel(as)}</span>
            {naam}
          </span>
        ))}
      </div>

      <div className="section-label">
        <span>Provider offerings</span>
        <span className="rule" />
      </div>
      <div className="ptable-wrap">
        <table className="ptable">
        <caption className="sr-only">
          Provider offerings compared on {comparedOn} and capabilities
        </caption>
        <thead>
          <tr>
            <th>Offering</th>
            {numeric.map((axis) => (
              <th className="num" key={axis.key}>
                {columnHeader(axis, priceUnit)}
              </th>
            ))}
            <th>Capabilities</th>
          </tr>
        </thead>
        <tbody>
          {artefact.providers.map((p) => {
            const caps = badges.filter((axis) => flag(p, axis.metric));
            return (
              <tr key={p.naam}>
                <td className="offering">
                  {p.naam}
                  <span className="offering-sub">{p.provider}</span>
                </td>
                {numeric.map((axis) => (
                  <td className="num" key={axis.key}>
                    {numericCell(p, axis)}
                    {axis.metric === PRIJS_METRIC && p.prijs.vergelijkbaar === false ? (
                      <span className="fn-mark">*</span>
                    ) : null}
                  </td>
                ))}
                <td className="caps">
                  {caps.length > 0
                    ? caps.map((axis) => (
                        <span className="cap-badge" key={axis.key}>
                          {axis.kolom}
                        </span>
                      ))
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
      {artefact.providers.some((p) => p.prijs.vergelijkbaar === false) ? (
        <p className="table-note">
          <span className="fn-mark">*</span> token-/credit-priced — the headline understates real
          per-unit cost, so it is excluded from the cheapest ranking.
        </p>
      ) : null}

      <div className="section-label">
        <span>Sources</span>
        <span className="rule" />
      </div>
      <ul className="sources">
        {artefact.bronnen.map((b) => (
          <li key={b.url}>
            <a href={b.url}>{b.titel}</a>
            <span className="src-date">{b.datum}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
