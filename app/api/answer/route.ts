import { getArtefactByQuery } from "@/lib/artefact";
import { getRanking } from "@/lib/categories";
import { toPublicArtefact } from "@/lib/contract";
import { artefactToMarkdown } from "@/lib/markdown";
import { recordCall } from "@/lib/telemetry";

// Machine-endpoint view of the Antwoord-artefact (ADR 0002), answering by
// query (ADR 0005). MVP-1 is free, no x402 (success metric = adoption, Q6).
// Same resource, two formats: JSON (default) and Markdown (?format=md) — the
// format agents prefer to inject into their context. Same hap in both.
// Input bounds: guard the engine and telemetry against oversized/garbage input
// before any lookup or DB write. URLSearchParams.get() already yields string |
// null, so we cap length rather than re-check the type. A query past the cap or
// a category past the cap is a 400 (clearly client error), not a silent trim.
const MAX_QUERY_LEN = 512;
const MAX_CATEGORY_LEN = 64;

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const query = params.get("query") ?? "";
  // Explicit category wins over keyword detection (ADR 0010 point 3); absent =
  // detect from the query, falling back to the default category.
  const category = params.get("category") ?? undefined;

  if (query.length > MAX_QUERY_LEN) {
    return Response.json(
      { error: `query too long (max ${MAX_QUERY_LEN} characters)` },
      { status: 400 },
    );
  }
  if (category !== undefined && category.length > MAX_CATEGORY_LEN) {
    return Response.json(
      { error: `category too long (max ${MAX_CATEGORY_LEN} characters)` },
      { status: 400 },
    );
  }

  const artefact = getArtefactByQuery(query, category);
  const format = params.get("format") === "md" ? "md" : "json";

  // North-star telemetry (Q6): record real query attempts (fire-and-forget).
  if (query.trim() !== "") {
    recordCall(request, {
      endpoint: "answer",
      format,
      category: artefact?.category ?? null,
      query,
    });
  }

  if (!artefact) {
    return Response.json(
      { error: "No answer artefact for this query." },
      { status: 404 },
    );
  }

  if (format === "md") {
    // Category-rich Markdown: pass the category's decision-axes so the provider
    // table renders numeric-axis columns + capability badges (ADR 0010), mirroring
    // the human page. Empty axes on a no-match degrade to a bare table.
    const assen = getRanking(artefact.category)?.assen ?? [];
    return new Response(artefactToMarkdown(artefact, assen), {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }

  // The REST JSON is the English public contract (Bevinding ③): project the
  // internal Dutch-keyed artefact to the English shape at the boundary.
  return Response.json(toPublicArtefact(artefact));
}
