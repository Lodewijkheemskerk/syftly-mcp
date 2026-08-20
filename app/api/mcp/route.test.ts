import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/mcp/route";
import { TOOL } from "@/lib/mcp";
import { recordCall } from "@/lib/telemetry";

vi.mock("@/lib/telemetry", () => ({ recordCall: vi.fn() }));

// The POST route is the thin transport adapter: Request -> handleRpc -> Response.
// MCP over Streamable HTTP is JSON-RPC 2.0 over POST.
function rpc(body: unknown): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Telemetry category (observed gap): agents almost never pass an explicit
// category, so recording only the explicit argument left most events
// uncategorized (null) even though routing detected the category fine. The
// route records the DETECTED category as fallback; an explicit one still wins.
describe("POST /api/mcp — telemetry category", () => {
  beforeEach(() => vi.mocked(recordCall).mockClear());

  it("records the detected category when the caller omits it", async () => {
    await POST(
      rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: TOOL.name, arguments: { query: "best OCR API for scanned invoices" } },
      }),
    );
    expect(recordCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: "ocr" }),
    );
  });

  it("keeps an explicit category over detection", async () => {
    await POST(
      rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: TOOL.name,
          arguments: { query: "best OCR API for scanned invoices", category: "scraping" },
        },
      }),
    );
    expect(recordCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: "scraping" }),
    );
  });

  it("records null when nothing matches", async () => {
    await POST(
      rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: TOOL.name, arguments: { query: "zzz nothing matches this" } },
      }),
    );
    expect(recordCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: null }),
    );
  });
});

describe("POST /api/mcp", () => {
  it("tools/call geeft 200 + structuredContent voor een bekende query", async () => {
    const res = await POST(
      rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: TOOL.name,
          arguments: { query: "Best transcription API for Dutch" },
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.structuredContent.category).toBe("transcription");
  });

  it("een notificatie krijgt 202 zonder body", async () => {
    const res = await POST(
      rpc({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(res.status).toBe(202);
  });

  it("ongeldige JSON geeft een parse-error (-32700)", async () => {
    const req = new Request("http://localhost/api/mcp", {
      method: "POST",
      body: "{niet-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  // FIX 4: an array body is a JSON-RPC batch — mapped per entry into an array
  // response, not silently dropped (and telemetry doesn't blow up on it).
  it("een batch (array body) geeft een array met één response per request", async () => {
    const res = await POST(
      rpc([
        { jsonrpc: "2.0", id: 1, method: "initialize" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe(1);
    expect(body[1].id).toBe(2);
  });

  it("een batch met alleen notificaties geeft 202 zonder body", async () => {
    const res = await POST(rpc([{ jsonrpc: "2.0", method: "notifications/initialized" }]));
    expect(res.status).toBe(202);
  });
});
