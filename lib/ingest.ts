import type { CategorieRanking } from "@/lib/types";
import { checkRanking, type GateFailure } from "@/lib/gates";

// The boundary between an untrusted candidate ranking (pasted from a manual
// recept-run, or later produced by the LLM pipeline — ADR 0008) and the
// published ranking. Three steps: parse -> structural guard -> quality gates
// (ADR 0007). The structural guard runs first so the value-gates never throw on
// a malformed shape; everything is reported as GateFailure[] for the kill-switch.

export type IngestResult =
  | { ok: true; ranking: CategorieRanking }
  | { ok: false; failures: GateFailure[] };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function isNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

// Pragmatic shape check: covers exactly the fields the value-gates dereference,
// so a malformed candidate fails cleanly instead of crashing checkRanking.
function checkStructure(value: unknown): GateFailure[] {
  const gate = "structuur";
  const f: GateFailure[] = [];
  if (!isObject(value)) return [{ gate, message: "de ranking is geen object." }];

  for (const key of ["category", "zekerheidslabel", "laatst_bijgewerkt"] as const) {
    if (!isString(value[key])) {
      f.push({ gate, message: `veld "${key}" ontbreekt of is geen string.` });
    }
  }

  const providers = value.providers;
  if (!Array.isArray(providers)) {
    f.push({ gate, message: `"providers" ontbreekt of is geen array.` });
  } else {
    providers.forEach((p, i) => {
      if (!isObject(p)) {
        f.push({ gate, message: `provider[${i}] is geen object.` });
        return;
      }
      for (const key of ["naam", "provider", "sterk", "zwak", "bron", "bron_datum"] as const) {
        if (!isString(p[key])) {
          f.push({ gate, message: `provider[${i}].${key} ontbreekt of is geen string.` });
        }
      }
      const prijs = p.prijs;
      if (!isObject(prijs)) {
        f.push({ gate, message: `provider[${i}].prijs ontbreekt of is geen object.` });
      } else {
        // null is a legal price: "no verifiable rate" (Reducto/Speechmatics
        // precedent) — the value gates enforce the null+vergelijkbaar pairing.
        if (prijs.waarde !== null && !isNumber(prijs.waarde)) {
          f.push({ gate, message: `provider[${i}].prijs.waarde is geen getal of null.` });
        }
        if (!isString(prijs.eenheid)) {
          f.push({ gate, message: `provider[${i}].prijs.eenheid is geen string.` });
        }
      }
    });
  }

  const bronnen = value.bronnen;
  if (!Array.isArray(bronnen)) {
    f.push({ gate, message: `"bronnen" ontbreekt of is geen array.` });
  } else {
    bronnen.forEach((b, i) => {
      if (!isObject(b)) {
        f.push({ gate, message: `bron[${i}] is geen object.` });
        return;
      }
      for (const key of ["titel", "url", "datum"] as const) {
        if (!isString(b[key])) {
          f.push({ gate, message: `bron[${i}].${key} ontbreekt of is geen string.` });
        }
      }
    });
  }

  const queries = value.queries;
  if (!isObject(queries)) {
    f.push({ gate, message: `"queries" ontbreekt of is geen object.` });
  } else {
    for (const [slug, view] of Object.entries(queries)) {
      if (!isObject(view)) {
        f.push({ gate, message: `query "${slug}" is geen object.` });
        continue;
      }
      if (!isString(view.query)) f.push({ gate, message: `query "${slug}".query is geen string.` });
      if (!isString(view.hap)) f.push({ gate, message: `query "${slug}".hap is geen string.` });
      const rec = view.recommendation;
      if (!isObject(rec)) {
        f.push({ gate, message: `query "${slug}".recommendation ontbreekt of is geen object.` });
      } else {
        if (!isString(rec.default)) {
          f.push({ gate, message: `query "${slug}".recommendation.default is geen string.` });
        }
        if (!isObject(rec.axes)) {
          f.push({ gate, message: `query "${slug}".recommendation.axes ontbreekt of is geen object.` });
        }
      }
    }
  }

  return f;
}

/**
 * Validate a candidate ranking before it can be published. Accepts a JSON
 * string or an already-parsed value. Returns the typed ranking when it passes
 * structure + every quality gate, otherwise the collected failures (ok=false →
 * do not publish; hand to the kill-switch — ADR 0007).
 */
export function parseAndCheckRanking(raw: string | unknown): IngestResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, failures: [{ gate: "parse", message: "ongeldige JSON." }] };
    }
  }

  const structural = checkStructure(value);
  if (structural.length > 0) return { ok: false, failures: structural };

  const ranking = value as CategorieRanking;
  const verdict = checkRanking(ranking);
  if (!verdict.ok) return { ok: false, failures: verdict.failures };

  return { ok: true, ranking };
}
