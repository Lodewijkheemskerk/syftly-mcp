import { handleRpc, handleRpcBatch, clientInfoFrom, type JsonRpcRequest } from "@/lib/mcp";
import { matchCategory } from "@/lib/categories";
import { recordCall } from "@/lib/telemetry";

// One entry shape for telemetry: a tools/call with a non-empty query.
type RpcLike = {
  method?: string;
  params?: { arguments?: { query?: string; category?: string } };
};

// Record actual tool calls (fire-and-forget). Tolerates an array body by being
// called per-entry; never throws into the response path.
function recordToolCall(request: Request, rpc: RpcLike): void {
  try {
    if (rpc?.method === "tools/call" && (rpc.params?.arguments?.query ?? "").trim() !== "") {
      const query = rpc.params?.arguments?.query ?? "";
      recordCall(request, {
        endpoint: "mcp",
        format: "mcp",
        // Agents almost never pass an explicit category, which left most events
        // uncategorized even though routing detected one fine — so fall back to
        // the detected category (same matcher the engine routes with).
        category: rpc.params?.arguments?.category ?? matchCategory(query),
        query,
      });
    }
  } catch {
    // never break the response over telemetry
  }
}

// Record the initialize handshake with the client's self-reported identity
// (clientInfo.name/version) — the only moment a stateless MCP client names
// itself. Gives the admin Callers panel "which agent-tool connected"; these
// init rows are excluded from the usage metrics (they signal a connection,
// not a question). Fire-and-forget, same contract as recordToolCall.
function recordInit(request: Request, rpc: unknown): void {
  try {
    const clientInfo = clientInfoFrom(rpc);
    if (clientInfo !== null) {
      recordCall(request, {
        endpoint: "mcp",
        format: "init",
        category: null,
        query: "(initialize)",
        clientInfo,
      });
    }
  } catch {
    // never break the response over telemetry
  }
}

// MCP over Streamable HTTP (stateless): JSON-RPC 2.0 over POST. This is the
// machine view of the Antwoord-artefact (ADR 0002), reusing the same category
// ranking as the human page and /api/answer. Thin adapter over lib/mcp.
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  // JSON-RPC batch (array body): map each entry through the handler (lib/mcp
  // handleRpcBatch). Notification entries yield no response; if all were
  // notifications the result array is empty → 202 Accepted, no body.
  if (Array.isArray(body)) {
    for (const entry of body) {
      recordToolCall(request, entry as RpcLike);
      recordInit(request, entry);
    }
    const out = handleRpcBatch(body as JsonRpcRequest[]);
    if (Array.isArray(out) && out.length === 0) {
      return new Response(null, { status: 202 });
    }
    return Response.json(out);
  }

  const res = handleRpc(body as JsonRpcRequest);

  // North-star telemetry (Q6): record actual tool calls (fire-and-forget),
  // plus the initialize handshake for client identity.
  recordToolCall(request, body as RpcLike);
  recordInit(request, body);

  // A notification yields no response body (202 Accepted).
  if (res === null) return new Response(null, { status: 202 });
  return Response.json(res);
}
