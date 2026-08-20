import type { CategorieRanking } from "@/lib/types";
import { axisPickers, PRIJS_METRIC } from "@/lib/engine";

// Kwaliteitspoorten (ADR 0007/0008): deterministic, automated checks that run
// every cycle before publication. A failure feeds the kill-switch (human-by-
// exception), not a content review — credibility comes from provenance, the
// floor comes from these gates. This is the LLM-free half of the recept-
// pijplijn; the extract-then-judge phases (which need a paid LLM) slot in
// behind a passing gate later. Each gate is a pure function returning its
// failures, so the verdict is fully testable offline.

export interface GateFailure {
  gate: string;
  message: string;
}

export interface GateResult {
  ok: boolean;
  failures: GateFailure[];
}

// Calendar-correct ISO date (yyyy-mm-dd). The regex pins the shape; Date.parse
// rejects impossible days like 2026-06-31.
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function isWellFormedHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// A ranking with no providers or no queries cannot back any answer.
function gateNietLeeg(ranking: CategorieRanking): GateFailure[] {
  const gate = "niet-leeg";
  const failures: GateFailure[] = [];
  if (ranking.providers.length === 0) {
    failures.push({ gate, message: "de ranking heeft geen providers." });
  }
  if (Object.keys(ranking.queries).length === 0) {
    failures.push({ gate, message: "de ranking heeft geen gepubliceerde queries." });
  }
  return failures;
}

function gateGeldigeDatums(ranking: CategorieRanking): GateFailure[] {
  const gate = "geldige-datums";
  const failures: GateFailure[] = [];
  if (!isIsoDate(ranking.laatst_bijgewerkt)) {
    failures.push({
      gate,
      message: `laatst_bijgewerkt is geen geldige ISO-datum: "${ranking.laatst_bijgewerkt}".`,
    });
  }
  for (const p of ranking.providers) {
    if (!isIsoDate(p.bron_datum)) {
      failures.push({
        gate,
        message: `provider "${p.naam}" heeft geen geldige bron_datum: "${p.bron_datum}".`,
      });
    }
  }
  for (const b of ranking.bronnen) {
    if (!isIsoDate(b.datum)) {
      failures.push({ gate, message: `bron "${b.titel}" heeft geen geldige datum: "${b.datum}".` });
    }
  }
  return failures;
}

function gateProviderVelden(ranking: CategorieRanking): GateFailure[] {
  const gate = "provider-velden-compleet";
  const failures: GateFailure[] = [];
  for (const p of ranking.providers) {
    const id = p.naam?.trim() || "(naamloos)";
    if (!p.naam?.trim()) failures.push({ gate, message: "een provider mist een naam." });
    if (!p.provider?.trim()) failures.push({ gate, message: `provider "${id}" mist het bedrijf (provider).` });
    if (!p.sterk?.trim()) failures.push({ gate, message: `provider "${id}" mist "sterk".` });
    if (!p.zwak?.trim()) failures.push({ gate, message: `provider "${id}" mist "zwak".` });
    if (!p.bron?.trim()) failures.push({ gate, message: `provider "${id}" mist een bron.` });
    // A comparable offering needs a positive price; a non-comparable one
    // (vergelijkbaar:false) may have a null/unknown price — an honest gap that
    // the price sentinel already excludes from the cheapest axis (ADR 0009/0010).
    const waarde = p.prijs?.waarde;
    const incomparable = p.prijs?.vergelijkbaar === false;
    const priceOk = p.prijs
      ? typeof waarde === "number"
        ? waarde > 0
        : waarde == null && incomparable
      : false;
    if (!priceOk) {
      failures.push({
        gate,
        message: `provider "${id}" heeft geen geldige prijs (positief getal, of null mits vergelijkbaar:false).`,
      });
    }
    if (!p.prijs?.eenheid?.trim()) {
      failures.push({ gate, message: `provider "${id}" mist een prijs-eenheid.` });
    }
  }
  return failures;
}

// Every recommendation (default and per-axis) must name a Provider-aanbod that
// actually exists in the ranking — otherwise an agent gets pointed at nothing.
function gateAanbevelingVerwijst(ranking: CategorieRanking): GateFailure[] {
  const gate = "aanbeveling-verwijst-naar-bestaand-aanbod";
  const failures: GateFailure[] = [];
  const namen = new Set(ranking.providers.map((p) => p.naam));
  for (const [slug, view] of Object.entries(ranking.queries)) {
    if (!namen.has(view.recommendation.default)) {
      failures.push({
        gate,
        message: `query "${slug}": default "${view.recommendation.default}" staat niet in de provider-lijst.`,
      });
    }
    for (const [as, naam] of Object.entries(view.recommendation.axes)) {
      if (!namen.has(naam)) {
        failures.push({
          gate,
          message: `query "${slug}", as "${as}": "${naam}" staat niet in de provider-lijst.`,
        });
      }
    }
  }
  return failures;
}

// Every metric an as references must be well-formed on every provider, or a
// computed verdict would be silently wrong (ADR 0010 catches the lost compile-
// time typing here, at runtime). The gate validates EXISTENCE + the right KIND
// of value — not domain ranges, which are category-specific: a min/max axis
// needs a non-negative number (or null = honest gap); a filter axis needs a
// boolean (or null). The price sentinel is validated by gateProviderVelden.
// Metrics not referenced by any as are free-form metadata and not checked.
function gateAsVelden(ranking: CategorieRanking): GateFailure[] {
  const gate = "as-velden";
  const failures: GateFailure[] = [];
  for (const axis of ranking.assen) {
    if (axis.metric === PRIJS_METRIC) continue; // price handled by provider-velden
    for (const p of ranking.providers) {
      const id = p.naam?.trim() || "(naamloos)";
      const v = p.metrics?.[axis.metric];
      if (v === undefined) {
        failures.push({ gate, message: `provider "${id}" mist de as-metric "${axis.metric}".` });
        continue;
      }
      if (v === null) continue; // honest gap — allowed
      if (axis.richting === "filter") {
        if (typeof v !== "boolean") {
          failures.push({
            gate,
            message: `provider "${id}" metric "${axis.metric}" moet boolean zijn (filter-as), kreeg "${v}".`,
          });
        }
      } else if (!(typeof v === "number" && Number.isFinite(v) && v >= 0)) {
        failures.push({
          gate,
          message: `provider "${id}" metric "${axis.metric}" moet een niet-negatief getal zijn (${axis.richting}-as), kreeg "${v}".`,
        });
      }
    }
  }
  return failures;
}

// Every per-axis etalage recommendation must name the SAME offering the engine
// computes for that axis (ADR 0009: the verdict is computed, not authored). A
// hand-written etalage that contradicts the engine is fakery — this is the honesty
// poort. Unknown axis-keys are skipped (their existence is checked elsewhere);
// the verdict falls out of the shared AXIS_PICKERS, so a new recept-run keeps both
// sides in lock-step.
function gateAanbevelingConsistent(ranking: CategorieRanking): GateFailure[] {
  const gate = "aanbeveling-consistent-met-engine";
  const failures: GateFailure[] = [];
  const pickers = axisPickers(ranking);
  for (const [slug, view] of Object.entries(ranking.queries)) {
    for (const [as, naam] of Object.entries(view.recommendation.axes)) {
      const picker = pickers[as];
      if (!picker) continue;
      const winner = picker();
      if (winner && winner.naam !== naam) {
        failures.push({
          gate,
          message: `query "${slug}", as "${as}": "${naam}" is niet de engine-winnaar ("${winner.naam}").`,
        });
      }
    }
  }
  return failures;
}

// The hap is the citeerbare kern: 40–80 words, self-contained (CONTEXT "Hap").
// Too short = thin/uncitable; too long = no longer a snippet AI machines lift
// verbatim. Counted on whitespace-separated word tokens.
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function gateHapLengte(ranking: CategorieRanking): GateFailure[] {
  const gate = "hap-lengte";
  const failures: GateFailure[] = [];
  for (const [slug, view] of Object.entries(ranking.queries)) {
    const n = wordCount(view.hap ?? "");
    if (n < 40 || n > 80) {
      failures.push({
        gate,
        message: `query "${slug}": hap is ${n} woorden, moet 40–80 zijn.`,
      });
    }
  }
  return failures;
}

// Word-trigram set of a hap (lowercased, punctuation-split). Trigrams are
// specific enough that two genuinely different haps over the same domain share
// almost none, while a near-copy shares most — so shared domain words ("WER",
// "API") don't trip the check, but doorway-style duplicates do.
function trigrams(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) {
    grams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const g of a) if (b.has(g)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

// Every published query must carry a substantially UNIQUE hap. Near-duplicate
// haps are the scaled-content/doorway pages ADR 0009 warns demote the whole site,
// so two haps overlapping above the threshold fail the gate (the kill-switch,
// not a content review — ADR 0007).
const HAP_OVERLAP_DREMPEL = 0.5;

function gateHapUniek(ranking: CategorieRanking): GateFailure[] {
  const gate = "hap-uniek";
  const failures: GateFailure[] = [];
  const entries = Object.entries(ranking.queries).map(
    ([slug, view]) => [slug, trigrams(view.hap ?? "")] as const,
  );
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const overlap = jaccard(entries[i][1], entries[j][1]);
      if (overlap > HAP_OVERLAP_DREMPEL) {
        failures.push({
          gate,
          message: `queries "${entries[i][0]}" en "${entries[j][0]}" hebben near-duplicate haps (overlap ${overlap.toFixed(2)}).`,
        });
      }
    }
  }
  return failures;
}

// The hap is hand-written prose; the provider table is COMPUTED (ADR 0009), so
// the two can drift — a recept-run changes a price or score, but the hap still
// quotes the old number. No other gate catches a stale FIGURE in the citeerbare
// kern (aanbeveling-consistent only checks the recommendation fields, not the
// prose). This gate is that drift-vangnet: every UNIT-ANCHORED number in a hap
// must equal a real value in the ranking.
//
// Scope is deliberately narrow to stay false-positive-free. A number is a claim
// only when it borders a recognised unit marker, and the markers are derived
// from the ranking itself (no category-hardcoding, ADR 0010): a currency symbol
// → must match a prijs.waarde; a unit an as declares via `eenheid` (e.g. "%",
// "ms") → must match a metric of an as carrying that unit. Bare counts ("99
// languages", the year "2026") and the unit's own denominator ("$3.50/1000 min"
// → 1000) carry no marker and are left to the manual spotcheck. Matching numbers
// — not meaning — keeps this deterministic and free of brittle prose-NLP.
const VALUTA_SYMBOLEN = ["$", "€", "£"];
const CIJFER = "[0-9]+(?:\\.[0-9]+)?";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A figure is "covered" if it equals a structured value; a tiny epsilon absorbs
// float representation (3.50 === 3.5), not genuine rounding.
function isCovered(n: number, values: number[]): boolean {
  return values.some((v) => Math.abs(v - n) < 1e-9);
}

function gateHapCijfersGedekt(ranking: CategorieRanking): GateFailure[] {
  const gate = "hap-cijfers-gedekt";
  const failures: GateFailure[] = [];

  // Target set per marker, straight off the ranking. Currency → every non-null
  // price (incomparable ones included: a hap may still quote them honestly).
  const prijsWaarden = ranking.providers
    .map((p) => p.prijs?.waarde)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  // Each declared unit (trimmed `eenheid`, "-"/empty skipped) → the numeric
  // metric values of the assen carrying it.
  const eenheden = [
    ...new Set(
      ranking.assen
        .map((a) => (a.eenheid ?? "").trim())
        .filter((u) => u.length > 0 && u !== "-"),
    ),
  ];
  const eenheidWaarden = new Map<string, number[]>(
    eenheden.map((u) => {
      const metrics = ranking.assen
        .filter((a) => (a.eenheid ?? "").trim() === u)
        .map((a) => a.metric);
      const vals: number[] = [];
      for (const p of ranking.providers) {
        for (const m of metrics) {
          const v = p.metrics?.[m];
          if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
        }
      }
      return [u, vals];
    }),
  );

  const valutaKlasse = `[${VALUTA_SYMBOLEN.map(escapeRegex).join("")}]`;
  const valutaRe = new RegExp(`${valutaKlasse}\\s*(${CIJFER})`, "g");

  for (const [slug, view] of Object.entries(ranking.queries)) {
    const hap = view.hap ?? "";

    // Currency-anchored: the amount right after the symbol (not the unit's
    // denominator, which has no symbol in front of it).
    for (const m of hap.matchAll(valutaRe)) {
      const n = parseFloat(m[1]);
      if (!isCovered(n, prijsWaarden)) {
        failures.push({
          gate,
          message: `query "${slug}": prijs "${m[0]}" in de hap staat niet in de provider-tabel.`,
        });
      }
    }

    // Unit-suffix-anchored: a number immediately followed by a declared unit.
    // The trailing (?![a-z]) keeps "ms" from matching inside "msec"/"items".
    for (const u of eenheden) {
      const re = new RegExp(`(${CIJFER})\\s*${escapeRegex(u)}(?![a-z])`, "gi");
      for (const m of hap.matchAll(re)) {
        const n = parseFloat(m[1]);
        if (!isCovered(n, eenheidWaarden.get(u)!)) {
          failures.push({
            gate,
            message: `query "${slug}": waarde "${m[0]}" in de hap staat niet in de provider-tabel.`,
          });
        }
      }
    }
  }
  return failures;
}

// Offline well-formedness of bron URLs. Live network reachability (ADR 0008's
// "bron-bereikbaarheid") is a separate online gate, added when the cycle runs.
function gateBronnenWelgevormd(ranking: CategorieRanking): GateFailure[] {
  const gate = "bron-welgevormd";
  const failures: GateFailure[] = [];
  for (const b of ranking.bronnen) {
    if (!isWellFormedHttpUrl(b.url)) {
      failures.push({ gate, message: `bron "${b.titel}" heeft een ongeldige URL: "${b.url}".` });
    }
  }
  return failures;
}

/**
 * Run every quality gate over a Categorie-ranking and return the combined
 * verdict. ok=false means: do not publish — hand to the kill-switch (ADR 0007).
 */
export function checkRanking(ranking: CategorieRanking): GateResult {
  const failures = [
    ...gateNietLeeg(ranking),
    ...gateGeldigeDatums(ranking),
    ...gateProviderVelden(ranking),
    ...gateAsVelden(ranking),
    ...gateAanbevelingVerwijst(ranking),
    ...gateAanbevelingConsistent(ranking),
    ...gateHapLengte(ranking),
    ...gateHapUniek(ranking),
    ...gateHapCijfersGedekt(ranking),
    ...gateBronnenWelgevormd(ranking),
  ];
  return { ok: failures.length === 0, failures };
}
