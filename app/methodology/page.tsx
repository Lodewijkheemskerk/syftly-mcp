import type { Metadata } from "next";
import { listCategories } from "@/lib/categories";
import type { Bron, CategorieRanking } from "@/lib/types";

// Methodology: where Syftly is honest about how a verdict is reached (ADR 0001 no
// first-hand measurement, 0007 machine=quality/human=recipe, 0008 extract-then-
// judge, 0009 computed axes). Every scope number comes from the category REGISTRY
// (ADR 0010) — all categories, summed — so this page can never contradict the
// homepage totals or fossilize an MVP snapshot. Indexable: this is curated,
// substantial content (unlike engine long-tail answers, which are noindex).

export const metadata: Metadata = {
  title: "Methodology — Syftly",
  description:
    "How Syftly reaches a verdict: a light estimate aggregated from public benchmarks with sources and dates, with the winner computed from structured fields — not first-hand measurement, not editorial selection.",
};

// The seven computed decision axes of the transcription category — the worked
// example below the registry-wide stats. Every category declares its own axes in
// its ranking config; the winner on each is computed from structured provider
// fields, never hand-picked per query (ADR 0009).
const AXES: { name: string; rule: string }[] = [
  { name: "Cheapest", rule: "lowest directly-comparable per-minute price" },
  { name: "Most accurate", rule: "lowest word error rate (WER)" },
  { name: "Most multilingual", rule: "highest supported-language count" },
  { name: "Lowest latency", rule: "lowest published streaming latency" },
  { name: "Best price-to-accuracy", rule: "lowest price × WER" },
  { name: "Capability filter", rule: "top-ranked offering that has diarization, word-timestamps or custom vocabulary" },
  { name: "Language", rule: "most accurate offering that supports the asked language (e.g. Dutch, Spanish)" },
];

export interface MethodologyModel {
  labels: string[];
  totals: { categories: number; offerings: number; queries: number; axes: number };
  sources: Bron[]; // union over all rankings, deduped by URL, registry order
}

// Pure, registry-driven view-model (same pattern as homeModel / categoryCards):
// totals are summed over every registered ranking and the sources are the deduped
// union of each ranking's provenance, so a new category or recept-run updates
// this page by itself.
export function methodologyModel(rankings: CategorieRanking[]): MethodologyModel {
  const seen = new Set<string>();
  const sources = rankings
    .flatMap((r) => r.bronnen)
    .filter((b) => (seen.has(b.url) ? false : (seen.add(b.url), true)));
  return {
    labels: rankings.map((r) => r.label),
    totals: {
      categories: rankings.length,
      offerings: rankings.reduce((n, r) => n + r.providers.length, 0),
      queries: rankings.reduce((n, r) => n + Object.keys(r.queries).length, 0),
      axes: rankings.reduce((n, r) => n + r.assen.length, 0),
    },
    sources,
  };
}

export default function Page() {
  const { labels, totals, sources } = methodologyModel(listCategories());

  return (
    <main className="prose-page">
      <div className="answer-meta">
        <span className="trust-badge">
          <span className="trust-dot" />
          methodology
        </span>
        <span className="meta-mono">how we reach a verdict</span>
      </div>

      <h1>A light estimate, computed — not measured, not edited</h1>
      <p className="hap">
        Every Syftly answer carries a confidence label. Today it reads{" "}
        <strong>light estimate</strong>: the verdict is aggregated from public benchmarks — with
        sources and dates — and computed from structured fields, not produced by first-hand Syftly
        measurement and not chosen by an editor. Here is exactly how it works, and where it is weak.
      </p>

      {/* Scope — real numbers, summed over the whole registry */}
      <div className="section-label">
        <span>What we cover today</span>
        <span className="rule" />
      </div>
      <ul className="stat-grid">
        <li>
          <span className="stat-num">{totals.categories}</span>
          <span className="stat-label">categories — {labels.join(", ")}</span>
        </li>
        <li>
          <span className="stat-num">{totals.offerings}</span>
          <span className="stat-label">provider offerings, each a callable API + model-tier</span>
        </li>
        <li>
          <span className="stat-num">{totals.queries}</span>
          <span className="stat-label">
            published {totals.queries === 1 ? "query" : "queries"}, curated, hand-written &amp;
            indexable
          </span>
        </li>
        <li>
          <span className="stat-num">{totals.axes}</span>
          <span className="stat-label">computed decision axes the engine maps questions onto</span>
        </li>
      </ul>

      {/* Confidence label */}
      <div className="section-label">
        <span>Light estimate vs hard tested</span>
        <span className="rule" />
      </div>
      <p className="prose">
        <strong>Light estimate</strong> rests on public research and benchmarks (with attribution)
        plus AI-as-a-judge to synthesise. It is broad and useful, but always labelled as light.{" "}
        <strong>Hard tested</strong> would rest only on first-hand measured facts — latency, price
        and uptime probed by Syftly, accuracy scored against a verified ground truth. That tier{" "}
        <strong>does not exist yet</strong>; nothing here is presented as hard tested. AI-as-a-judge
        never counts as hard.
      </p>

      {/* The recipe */}
      <div className="section-label">
        <span>The recipe: computed, not edited</span>
        <span className="rule" />
      </div>
      <p className="prose">
        Each category is produced by a fixed, version-controlled research recipe: a source hierarchy
        (Tier-1 provider docs and recognised benchmarks carry the ranking; marketing never does),
        then a two-phase pipeline — deterministic extraction of the hard fields, then judged
        synthesis on top of that grounded data. The winner on each axis is then{" "}
        <strong>computed</strong> from those structured fields — &ldquo;cheapest&rdquo; is literally a{" "}
        <code className="inline">min()</code> over the prices. So a new recipe run changes the
        numbers and the winners recompute by themselves. Credibility comes from{" "}
        <strong>provenance</strong> — a dated source plus a confidence label plus attribution — not
        from human approval.
      </p>

      {/* Decision axes */}
      <div className="section-label">
        <span>The decision axes</span>
        <span className="rule" />
      </div>
      <p className="prose">
        A free question is mapped — deterministically, with no LLM call — onto a decision axis; its
        winner is computed from the ranking. Every category declares its own axes; the seven below
        (transcription) are the worked example. If nothing matches, the answer falls back to the
        category default (the top of the ordered ranking). An in-category question never 404s.
      </p>
      <table className="ptable">
        <caption className="sr-only">
          The transcription category&apos;s computed decision axes and the rule each uses
        </caption>
        <thead>
          <tr>
            <th>Axis</th>
            <th>Computed by</th>
          </tr>
        </thead>
        <tbody>
          {AXES.map((a) => (
            <tr key={a.name}>
              <td className="offering">{a.name}</td>
              <td>{a.rule}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Honest caveats */}
      <div className="section-label">
        <span>Where it is weak (read this)</span>
        <span className="rule" />
      </div>
      <ul className="caveats">
        <li>
          <strong>WER is English-leaning.</strong> Transcription accuracy uses the Artificial
          Analysis aggregate WER, which weights English heavily. A &ldquo;most accurate for
          Dutch&rdquo; verdict is a light estimate, not a Dutch-specific measurement.
        </li>
        <li>
          <strong>Token-priced models are excluded from &ldquo;cheapest&rdquo;.</strong> An
          LLM-based transcriber billed per input-audio token (e.g. Gemini) understates real cost, so
          it is not directly comparable to per-minute pricing and is kept out of the price axis.
        </li>
        <li>
          <strong>Latency figures are heterogeneous.</strong> Some are independent P50 numbers,
          others vendor claims; they are not strictly comparable, so a latency verdict carries that
          caveat.
        </li>
        <li>
          <strong>Only curated answers are indexable.</strong> Hand-written published queries are
          crawlable; on-demand engine answers for the long tail are served{" "}
          <code className="inline">noindex</code> so the site never fills with thin near-duplicate
          pages.
        </li>
      </ul>

      {/* Sources — the union of every ranking's provenance, deduped */}
      <div className="section-label">
        <span>Sources</span>
        <span className="rule" />
      </div>
      <p className="prose">
        Every ranking carries its own dated sources; this is the union across all{" "}
        {totals.categories} categories.
      </p>
      <ul className="sources">
        {sources.map((b) => (
          <li key={b.url}>
            <a href={b.url}>{b.titel}</a>
            <span className="src-date">{b.datum}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
