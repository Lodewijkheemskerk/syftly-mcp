import type { AntwoordArtefact, Beslisas, ProviderAanbod } from "@/lib/types";
import { PRIJS_METRIC } from "@/lib/engine";

// A fourth, machine-friendly view of the Antwoord-artefact (ADR 0002): the same
// hap, provider table and dated sources as the human page and the JSON/MCP
// endpoints, rendered as Markdown. Markdown is the format many agents prefer to
// drop straight into their context window — so it is a real consumption surface,
// not decoration. Pure function: takes an artefact, returns a string.

// Cell text may contain "|", which would break a Markdown table. Escape it so
// the table stays valid for any provider field. A raw newline would also split a
// table row (and any "real" content into a stray line), so collapse newlines to a
// space; backticks are escaped so a stray "`" can't open a code span that eats the
// rest of the row (FIX 2).
function cell(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`");
}

// Free text rendered OUTSIDE a table cell (the H1 query, the no-match message)
// is dropped verbatim into another agent's context, so it is a structure- and
// prompt-injection surface (FIX 1). Neutralise it: collapse all newlines to
// spaces (so a single `# ...` can't be turned into many lines / new headings),
// then backslash-escape any leading Markdown control character so the string
// renders as literal text, never as a heading / list / quote / code fence / table
// row. We escape the FIRST non-space character because Markdown block syntax is
// line-leading; inline "#" mid-sentence is harmless.
const LEADING_MD_CONTROL = /^(\s*)([#\-*>`|])/;
function inlineText(text: string): string {
  const oneLine = text.replace(/\r?\n/g, " ").trim();
  return oneLine.replace(LEADING_MD_CONTROL, (_m, ws: string, ch: string) => `${ws}\\${ch}`);
}

// A Markdown link title may contain "[" or "]" (which break the [title](url)
// syntax), and the URL may carry a non-http scheme like javascript: (a clickable
// injection vector). Escape the brackets and allowlist only http(s) URLs,
// neutralising anything else to a harmless placeholder (FIX 3).
function linkTitle(text: string): string {
  return cell(text).replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : "#";
}

function axisLabel(slug: string): string {
  return slug.replace(/-/g, " ");
}

// Typed reads of the open metrics map (ADR 0010): a number metric or null, and a
// boolean trait. Mirrors app/[category]/[query]/page.tsx so the Markdown table is
// as rich as the human table (numeric columns + capability badges).
function num(p: ProviderAanbod, key: string): number | null {
  const v = p.metrics?.[key];
  return typeof v === "number" ? v : null;
}
function flag(p: ProviderAanbod, key: string): boolean {
  return p.metrics?.[key] === true;
}

// Which axes the table renders, derived from the category's `assen` (ADR 0010):
// an axis appears IFF it declares a `kolom`. Numeric axes (min/max) become value
// columns — the price sentinel first, then config order — and filter axes become
// capability badges. Axes without a `kolom` stay routing-only. Same rule as the
// human page, so the two surfaces never disagree on what an offering is compared on.
function tableColumns(assen: Beslisas[]): { numeric: Beslisas[]; badges: Beslisas[] } {
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

// A numeric column header: the price sentinel carries its unit (values are bare
// numbers); other axes keep the unit on the value, so their header is bare. The
// header is trusted config (axis.kolom), but still escaped so a stray "|" in a
// unit can't break the table.
function columnHeader(axis: Beslisas, priceUnit: string): string {
  return axis.metric === PRIJS_METRIC ? `${axis.kolom} (${priceUnit})` : (axis.kolom ?? "");
}

// A numeric cell value: the price sentinel reads prijs.waarde; any other axis
// reads its metric and appends the axis unit. A missing number is an honest "—".
function numericCell(p: ProviderAanbod, axis: Beslisas): string {
  const v = axis.metric === PRIJS_METRIC ? p.prijs.waarde : num(p, axis.metric);
  return v == null ? "—" : `${v}${axis.eenheid ?? ""}`;
}

/**
 * Render an Antwoord-artefact as agent-facing Markdown (ADR 0002).
 *
 * `assen` is the category's decision-axis registry (ADR 0010). When supplied, the
 * provider table becomes category-specific — numeric axis columns (with units)
 * and capability badges — mirroring the human page, so an agent deciding on
 * latency/WER/price reads structured columns, not free text. When it is empty
 * (a no-match, or a caller with no registry access) the table degrades to a bare
 * Offering/Provider/Price table. Every untrusted string still runs through the
 * escaping helpers — this surface is prompt-injection hardened.
 */
export function artefactToMarkdown(a: AntwoordArtefact, assen: Beslisas[] = []): string {
  const lines: string[] = [];

  lines.push(`# ${inlineText(a.query)}`);
  lines.push("");

  // No-match (FIX 1): an honest message + the supported catalogue, NOT an empty
  // provider table or a blank default recommendation. routing !== "matched" means
  // the query fit no category (or was ambiguous), so there is nothing to compare.
  if (a.routing !== "matched") {
    // The no-match message can echo the (untrusted) query, so it is neutralised
    // the same way as the H1 (FIX 1).
    lines.push(inlineText(a.hap));
    lines.push("");
    if (a.categories && a.categories.length > 0) {
      lines.push("## Supported categories");
      lines.push("");
      for (const c of a.categories) lines.push(`- ${c.label} (\`${c.category}\`)`);
      lines.push("");
    }
    return lines.join("\n");
  }

  lines.push(`**Confidence:** ${a.zekerheidslabel} · **Last updated:** ${a.laatst_bijgewerkt}`);
  lines.push("");
  lines.push(a.hap);
  lines.push("");

  // Recommendation: default first (annotated when a primary ordering axis drove
  // it — the trade-off case, FIX 2), then one bullet per decision-axis naming its
  // own computed winner. A multi-axis answer thus shows BOTH the headline pick and
  // the per-axis breakdown, so the machine reader sees every winner, not one.
  const primaryNote = a.recommendation.primary
    ? ` (primary axis: ${axisLabel(a.recommendation.primary)})`
    : "";
  lines.push(`**Default:** ${a.recommendation.default}${primaryNote}`);
  for (const [as, naam] of Object.entries(a.recommendation.axes)) {
    lines.push(`- ${axisLabel(as)}: ${naam}`);
  }
  lines.push("");

  // Provider table — a real Markdown table (header + separator row) so agents
  // can parse the offerings without scraping prose. Columns are config-driven
  // (ADR 0010): the category's numeric decision-axes become value columns and its
  // filter axes become a Capabilities column, so the machine reader sees the same
  // structured comparison the human page shows — latency/WER/price as columns.
  const { numeric, badges } = tableColumns(assen);
  const priceUnit = a.providers[0]?.prijs.eenheid ?? "";
  // A price axis column already carries price; without one, keep a bare Price
  // column so the price is never dropped from the machine view.
  const hasPriceColumn = numeric.some((axis) => axis.metric === PRIJS_METRIC);

  const headerCells = ["Offering", "Provider"];
  if (!hasPriceColumn) headerCells.push("Price");
  for (const axis of numeric) headerCells.push(cell(columnHeader(axis, priceUnit)));
  if (badges.length > 0) headerCells.push("Capabilities");

  // Whether ANY row carries non-comparable / missing price — drives the caveat
  // footnote and the per-cell "*" marker (the honest token-pricing signal).
  const anyNonComparable = a.providers.some(
    (p) => p.prijs.vergelijkbaar === false || p.prijs.waarde == null,
  );

  lines.push("## Provider offerings");
  lines.push("");
  lines.push(`| ${headerCells.join(" | ")} |`);
  lines.push(`| ${headerCells.map(() => "---").join(" | ")} |`);
  for (const p of a.providers) {
    const nonComparable = p.prijs.vergelijkbaar === false || p.prijs.waarde == null;
    // The "*" marker is our own trusted glyph; backslash-escaped so it can never
    // pair with another "*" into stray Markdown emphasis across the table.
    const priceMark = nonComparable ? " \\*" : "";
    const rowCells = [cell(p.naam), cell(p.provider)];
    if (!hasPriceColumn) {
      const price = p.prijs.waarde == null ? "n/a" : `${p.prijs.waarde} ${p.prijs.eenheid}`;
      rowCells.push(`${cell(price)}${priceMark}`);
    }
    for (const axis of numeric) {
      const mark = axis.metric === PRIJS_METRIC ? priceMark : "";
      rowCells.push(`${cell(numericCell(p, axis))}${mark}`);
    }
    if (badges.length > 0) {
      const caps = badges.filter((axis) => flag(p, axis.metric)).map((axis) => cell(axis.kolom ?? ""));
      rowCells.push(caps.length > 0 ? caps.join(", ") : "—");
    }
    lines.push(`| ${rowCells.join(" | ")} |`);
  }
  lines.push("");

  // Token-pricing caveat (parity with the human page's footnote): carry the honest
  // signal that a non-comparable / n/a price understates real per-unit cost, so it
  // is excluded from the cheapest ranking. Leading "\*" renders as a literal "*".
  if (anyNonComparable) {
    lines.push(
      "\\* token-/credit-priced or no clean per-unit price — the headline understates real per-unit cost, so it is excluded from the cheapest ranking.",
    );
    lines.push("");
  }

  // Sources as dated links.
  lines.push("## Sources");
  lines.push("");
  for (const b of a.bronnen) {
    lines.push(`- [${linkTitle(b.titel)}](${safeUrl(b.url)}) — ${b.datum}`);
  }
  lines.push("");

  return lines.join("\n");
}
