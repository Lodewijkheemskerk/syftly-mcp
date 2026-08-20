import { getArtefactByQuery } from "@/lib/artefact";
import { getRanking, listCategories } from "@/lib/categories";
import { artefactToMarkdown } from "@/lib/markdown";
import { toPublicArtefact, PUBLIC_ARTEFACT_SCHEMA } from "@/lib/contract";

// The machine view of the Antwoord-artefact, served as an MCP tool (ADR 0002).
// This module is the deep core: a pure JSON-RPC 2.0 handler for the three
// methods a stateless MCP server needs (initialize, tools/list, tools/call).
// Hand-rolled so there is no new dependency; spec-shaped so swapping in a full
// MCP transport later is cheap. The route handler (app/api/mcp/route.ts) is a
// thin adapter over this.

const PROTOCOL_VERSION = "2025-06-18";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

// Every example query we advertise anywhere on the tool surface (description,
// input schema, instructions, error messages). Agents and scanners echo these
// VERBATIM when trying the tool out (observed: 65x the schema example from 51
// distinct callers), so lib/metrics.ts uses this list to label echo traffic
// instead of counting it as organic demand. Entries are append-only: an example
// removed from the surface stays here so historic echoes remain labeled.
export const EXAMPLE_QUERIES: readonly string[] = [
  "best transcription API for Dutch",
  "cheapest web search API",
  "best OCR API for scanned PDFs",
  "best web scraping API for JavaScript-heavy sites",
  // Slug-form curl example on the for-agents page — copy-pasted verbatim too.
  "best-transcription-api-for-dutch",
];

// Human-readable list of the categories the tool currently covers, derived from
// the registry (ADR 0010) so the description grows with the data and is never
// stale — no hard-coded "transcription only".
export function toolDescription(labels: string[]): string {
  const lower = labels.map((l) => l.toLowerCase());
  const list =
    lower.length <= 1
      ? (lower[0] ?? "no categories yet")
      : `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
  return (
    "Given a natural-language question about which AI tool or API is best for a task " +
    `(currently ${list}), return Syftly's ranked recommendation: a citeable summary, a ` +
    "provider table with prices and trade-offs, dated sources, and a confidence label. " +
    "Ask in plain English about price, accuracy, language or capability trade-offs — " +
    "e.g. 'best OCR API for scanned PDFs' or 'best web scraping API for JavaScript-heavy sites'. " +
    'Optionally pass "category" to disambiguate; otherwise it is detected from the question.'
  );
}

const CATEGORIES = listCategories();
const CATEGORY_IDS = new Set(CATEGORIES.map((r) => r.category));

// Upper bound on a query. A natural-language task description is short; anything
// far beyond this is noise or an attempt to flood another agent's context via the
// echoed-back Markdown (the MCP-path equivalent of the bound on /api/answer).
const MAX_QUERY_LENGTH = 512;

// A graceful tool-result error (isError:true) — the call reached us but the input
// was unusable. We never throw: a JSON-RPC error is for protocol faults, a
// tool-result error is for bad tool input.
function toolError(id: string | number | null, text: string): JsonRpcResponse {
  return ok(id, { content: [{ type: "text", text }], isError: true });
}

// The single tool: a query-engine over the category rankings (ADR 0005/0010).
// Its outputSchema is the machine contract for the Antwoord-artefact; its
// description and category enum are sourced from the registry, so registering a
// focus category in lib/categories.ts updates the advertised tool automatically.
export const TOOL = {
  name: "find_best_tool",
  description: toolDescription(CATEGORIES.map((r) => r.label)),
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description: "The question in natural language, e.g. 'best transcription API for Dutch'.",
      },
      category: {
        type: "string",
        description:
          "Optional category id to disambiguate the question; omit to let Syftly detect it.",
        enum: CATEGORIES.map((r) => r.category),
      },
    },
    additionalProperties: false,
  },
  // The machine contract is English (Bevinding ③): the tool's structuredContent
  // is the projected public artefact, so its outputSchema describes that English
  // shape. `routing` stays required, as before.
  outputSchema: PUBLIC_ARTEFACT_SCHEMA,
} as const;

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function callTool(id: string | number | null, params: unknown): JsonRpcResponse {
  // arguments is `unknown`-typed per field so the input guards below can reject a
  // non-string query/category instead of trusting the wire shape (FIX 5).
  const { name, arguments: args } = (params ?? {}) as {
    name?: string;
    arguments?: { query?: unknown; category?: unknown };
  };
  if (name !== TOOL.name) {
    return fail(id, -32602, `Unknown tool: ${name ?? "(none)"}`);
  }

  // Input guards (FIX 5): the query must be a string; a non-string (number,
  // object, …) is a malformed call, reported gracefully, not thrown.
  const rawQuery = args?.query;
  if (rawQuery !== undefined && typeof rawQuery !== "string") {
    return toolError(id, 'The "query" argument must be a string describing the task.');
  }
  const query = rawQuery ?? "";

  // Cap the query length so a single call can't flood the echoed-back Markdown
  // (the MCP-path equivalent of the bound on /api/answer, FIX 5).
  if (query.length > MAX_QUERY_LENGTH) {
    return toolError(
      id,
      `The "query" is too long (max ${MAX_QUERY_LENGTH} characters). Describe the task in a short sentence.`,
    );
  }

  // An empty/whitespace query is a usage error, not a lookup miss: ask the caller
  // to describe the task, in plain language with no internal jargon (FIX 1).
  if (query.trim().length === 0) {
    return toolError(
      id,
      "Please describe the task you need a tool for — for example 'best transcription API for Dutch' or 'cheapest web search API'.",
    );
  }

  // Validate the optional category against the known enum before routing, so an
  // unknown explicit category is a clear graceful error rather than a silent miss
  // (FIX 5). A non-string category is rejected the same way.
  const rawCategory = args?.category;
  let category: string | undefined;
  if (rawCategory !== undefined) {
    if (typeof rawCategory !== "string" || !CATEGORY_IDS.has(rawCategory)) {
      const shown = typeof rawCategory === "string" ? ` "${rawCategory}"` : "";
      return toolError(
        id,
        `Syftly doesn't have a category${shown}. Omit "category" to let Syftly route the question, or pick a supported one.`,
      );
    }
    category = rawCategory;
  }

  // An explicit category wins over keyword detection (ADR 0010 point 3). The
  // category is validated above, so this only fails on a genuine engine gap.
  const artefact = getArtefactByQuery(query, category);
  if (!artefact) {
    // Defensive: a validated category with no resolvable artefact is a tool-level
    // failure (isError on the result), not a JSON-RPC error.
    const where = category ? ` "${category}"` : "";
    return toolError(
      id,
      `Syftly doesn't have a category${where}. Omit "category" to let Syftly route the question, or pick a supported one.`,
    );
  }

  // structuredContent is the PUBLIC (English-keyed) artefact, validated by the
  // English outputSchema (Bevinding ③). Many MCP clients only surface
  // content[].text to the model, so we render the SAME artefact to Markdown there
  // — summary + a category-rich provider table (numeric axes + capabilities, from
  // the category's `assen`) + dated sources, or the honest no-match message — so
  // the agent sees the full comparison either way. A no-match is a NORMAL result
  // (isError:false): the call succeeded; routing carries that nothing was in scope.
  const assen = getRanking(artefact.category)?.assen ?? [];
  return ok(id, {
    content: [{ type: "text", text: artefactToMarkdown(artefact, assen) }],
    structuredContent: toPublicArtefact(artefact),
  });
}

/**
 * Extract the MCP client identity ("<name> <version>") from an initialize
 * request, or null when absent. The handshake is the only moment a client
 * names itself (clientInfo is not repeated on later stateless requests), so
 * telemetry records it here and the dashboard joins it to the caller id.
 * Untrusted input headed for the DB and the admin UI: bounded in length and
 * stripped of control characters.
 */
const MAX_CLIENT_INFO_LENGTH = 120;
export function clientInfoFrom(rpc: unknown): string | null {
  if (typeof rpc !== "object" || rpc === null) return null;
  const r = rpc as { method?: unknown; params?: { clientInfo?: unknown } };
  if (r.method !== "initialize") return null;
  const info = r.params?.clientInfo;
  if (typeof info !== "object" || info === null) return null;
  const { name, version } = info as { name?: unknown; version?: unknown };
  if (typeof name !== "string" || name.trim() === "") return null;
  const label = [name, typeof version === "string" ? version : ""]
    .join(" ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return label.slice(0, MAX_CLIENT_INFO_LENGTH);
}

/**
 * Handle one JSON-RPC request. Returns the response, or null for a notification
 * (no id) — which expects no reply per JSON-RPC 2.0.
 */
export function handleRpc(req: JsonRpcRequest): JsonRpcResponse | null {
  if (req.id === undefined) return null; // notification
  const id = req.id;

  switch (req.method) {
    case "initialize":
      // title + instructions are the server's self-description: registries
      // scanning the endpoint (Smithery, Glama) render them as the listing,
      // and connected agents read instructions to decide WHEN to call us.
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: "syftly",
          title: "Syftly — best API per task",
          version: "0.1.0",
        },
        instructions:
          "Call find_best_tool whenever you (or the user) need to pick an external API or AI tool for transcription, text-to-speech, web search, web scraping, or OCR/document extraction. Pass the task as one plain-English question — e.g. 'cheapest web search API' or 'best web scraping API for JavaScript-heavy sites' — and you get a ranked recommendation computed from public benchmarks: a provider table with prices, dated sources, and a confidence label, as both Markdown and structured JSON. One call, free, no auth, no setup.",
      });
    case "tools/list":
      return ok(id, { tools: [TOOL] });
    case "tools/call":
      return callTool(id, req.params);
    default:
      return fail(id, -32601, `Method not found: ${req.method}`);
  }
}

/**
 * Handle a JSON-RPC batch (an array request body, JSON-RPC 2.0 §6).
 *
 * DECISION: we MAP each entry through handleRpc and return an array of the
 * responses, rather than rejecting the batch. MCP clients legitimately batch
 * (e.g. a notifications/initialized alongside the first tools/call), so failing
 * fast would break real callers; mapping is the spec-compliant behaviour. Per the
 * spec, notification entries (no id) produce no response and are omitted, and an
 * empty array is itself an invalid request (-32600). If EVERY entry was a
 * notification the result array is empty; we return null so the transport can
 * answer with a no-content 202 (the batch was accepted, nothing to reply).
 *
 * Returns: an array of responses; [] when all entries were notifications (caller
 * sends 202/204); or a single -32600 error response for an empty batch.
 */
export function handleRpcBatch(batch: JsonRpcRequest[]): JsonRpcResponse[] | JsonRpcResponse {
  if (batch.length === 0) {
    return fail(null, -32600, "Invalid Request");
  }
  const responses: JsonRpcResponse[] = [];
  for (const req of batch) {
    const res = handleRpc(req);
    if (res !== null) responses.push(res); // omit notifications
  }
  return responses;
}
