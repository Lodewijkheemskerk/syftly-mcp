import { describe, it, expect } from "vitest";
import {
  handleRpc,
  handleRpcBatch,
  clientInfoFrom,
  TOOL,
  toolDescription,
  EXAMPLE_QUERIES,
  type JsonRpcResponse,
} from "@/lib/mcp";
import { toPublicArtefact, PUBLIC_ARTEFACT_SCHEMA } from "@/lib/contract";
import { getArtefactByQuery } from "@/lib/artefact";
import { listCategories } from "@/lib/categories";

// Slice (c): the machine-endpoint as an MCP-tool with outputSchema (ADR 0002).
// It is the third view of the same Antwoord-artefact — same getArtefactByQuery,
// same hap as the human page and /api/answer. We hand-roll a minimal, stateless
// MCP-over-HTTP (JSON-RPC 2.0) so there is no new dependency.
const KNOWN_QUERY = "Best transcription API for Dutch";

// Narrow casts keep the tests type-safe without `any` (result is `unknown`).
function result(res: JsonRpcResponse | null): Record<string, unknown> {
  return (res?.result ?? {}) as Record<string, unknown>;
}

describe("MCP tool definition", () => {
  it("adverteert de tool mét in- en outputSchema (English public contract, Bevinding ③)", () => {
    expect(TOOL.name.length).toBeGreaterThan(0);
    expect(TOOL.description.length).toBeGreaterThan(0);
    expect(TOOL.inputSchema.required).toContain("query");
    expect(TOOL.outputSchema).toBe(PUBLIC_ARTEFACT_SCHEMA);
    // The advertised contract is English-keyed and keeps routing required.
    expect(TOOL.outputSchema.required).toContain("summary");
    expect(TOOL.outputSchema.required).toContain("routing");
  });
});

// Agents and scanners echo the documented examples verbatim when testing the
// tool (observed: 65x the schema example from 51 distinct callers). Every
// example advertised on the tool surface must therefore be registered in
// EXAMPLE_QUERIES so the metrics can label those echoes instead of counting
// them as organic demand.
describe("EXAMPLE_QUERIES — advertised examples feed the echo filter", () => {
  it("registers every advertised example, including the historic schema example", () => {
    const init = result(handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }));
    const surface = JSON.stringify(TOOL) + String(init.instructions);
    for (const ex of [
      "best transcription API for Dutch",
      "cheapest web search API",
      "best OCR API for scanned PDFs",
      "best web scraping API for JavaScript-heavy sites",
    ]) {
      expect(EXAMPLE_QUERIES).toContain(ex);
      expect(surface).toContain(ex); // no dead entries: each is really advertised
    }
  });
});

describe("handleRpc — MCP over JSON-RPC", () => {
  it("initialize geeft protocolversie + tools-capability", () => {
    const res = handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const r = result(res);
    expect(r.protocolVersion).toBeTruthy();
    expect(r.capabilities).toMatchObject({ tools: {} });
    expect((r.serverInfo as { name?: string }).name).toBeTruthy();
  });

  // Registries (Smithery, Glama) and clients render these fields as the
  // listing description; instructions also tell a wired-up agent WHEN to call
  // the tool — the field that turns "installed" into "used".
  it("initialize geeft een title en instructions mee", () => {
    const res = handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const r = result(res);
    expect((r.serverInfo as { title?: string }).title).toContain("Syftly");
    expect(r.instructions).toContain("find_best_tool");
  });

  it("tools/list adverteert precies één tool mét outputSchema", () => {
    const res = handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = result(res).tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe(TOOL.name);
    expect(tools[0].outputSchema).toBeDefined();
  });

  it("tools/call geeft het artefact als structuredContent voor een bekende query", () => {
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: KNOWN_QUERY } },
    });
    const r = result(res);
    const artefact = getArtefactByQuery(KNOWN_QUERY)!;
    // structuredContent is the English PUBLIC projection of the artefact; the
    // summary is reused verbatim in the text content (Bevinding ③).
    expect(r.structuredContent).toEqual(toPublicArtefact(artefact));
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc.summary).toBe(artefact.hap); // English key
    expect(sc.hap).toBeUndefined(); // Dutch key does not leak
    const content = r.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain(artefact.hap);
    expect(r.isError).toBeFalsy();
  });

  it("tools/call levert de provider-tabel + prijzen + bronnen in content[].text, niet enkel de hap (Bevinding ②)", () => {
    // Many MCP clients only show the model content[].text, not structuredContent.
    // So the text view must carry the whole comparison: hap + every provider,
    // a concrete price, and the dated sources — facts that are NOT all in the hap.
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: KNOWN_QUERY } },
    });
    const r = result(res);
    const artefact = getArtefactByQuery(KNOWN_QUERY)!;
    const text = (r.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain(artefact.hap);
    for (const p of artefact.providers) expect(text).toContain(p.naam);
    expect(text).toContain(String(artefact.providers[0].prijs.waarde)); // a concrete price
    for (const b of artefact.bronnen) expect(text).toContain(b.titel); // dated sources
    expect(r.isError).toBeFalsy();
  });

  it("tools/call beantwoordt een vrije in-categorie query via de engine — geen isError (ADR 0009)", () => {
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: "cheapest transcription API" } },
    });
    const r = result(res);
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as { recommendation?: { default?: string } };
    expect(sc.recommendation?.default).toBe("AssemblyAI Universal-3 Pro"); // computed cheapest comparable
  });

  it("tools/call geeft een tool-error (isError) voor een lege query (geen vraag gesteld)", () => {
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: "" } },
    });
    expect(result(res).isError).toBe(true);
  });

  it("een lege query geeft een vriendelijke boodschap, geen interne term 'artefact' (FIX 1)", () => {
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 50,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: "   " } },
    });
    const r = result(res);
    const text = (r.content as Array<{ type: string; text: string }>)[0].text;
    expect(text.toLowerCase()).not.toContain("artefact");
    expect(text.toLowerCase()).toMatch(/describe|task|question/);
  });

  it("out-of-scope query geeft een eerlijk no-match resultaat — GEEN isError, GEEN transcriptie-antwoord (FIX 1)", () => {
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 51,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: "best image generation API" } },
    });
    const r = result(res);
    // MCP: the call succeeded; it just has no answer in scope → not isError.
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as { routing?: string; category?: string };
    expect(sc.routing).toBe("none");
    expect(sc.category).not.toBe("transcription");
    const text = (r.content as Array<{ type: string; text: string }>)[0].text;
    // the text view names the supported categories so the agent can re-ask
    expect(text.toLowerCase()).toContain("transcription");
    expect(text.toLowerCase()).not.toContain("artefact");
  });

  it("een natuurlijke web-search vraag routeert naar web-search, niet transcriptie (FIX 1)", () => {
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 52,
      method: "tools/call",
      params: {
        name: TOOL.name,
        arguments: { query: "API to get data from the web with real-time news freshness" },
      },
    });
    const r = result(res);
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as { routing?: string; category?: string };
    expect(sc.routing).toBe("matched");
    expect(sc.category).toBe("web-search");
  });

  it("onbekende methode geeft JSON-RPC -32601 (method not found)", () => {
    const res = handleRpc({ jsonrpc: "2.0", id: 5, method: "does/not/exist" });
    expect(res?.error?.code).toBe(-32601);
  });

  it("een notificatie (zonder id) krijgt geen antwoord", () => {
    const res = handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res).toBeNull();
  });
});

// HARDENING FIX 5: input guards on callTool — a graceful tool-result error, not
// a throw, for a non-string query, an oversized query, or an unknown category.
describe("tools/call — input guards (FIX 5)", () => {
  it("rejects an oversized query gracefully (isError, no throw)", () => {
    const long = "a".repeat(513);
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 60,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: long } },
    });
    const r = result(res);
    expect(r.isError).toBe(true);
    const text = (r.content as Array<{ type: string; text: string }>)[0].text;
    expect(text.toLowerCase()).toContain("too long");
  });

  it("accepts a query right at the 512-char bound", () => {
    const atBound = "transcription ".repeat(36).slice(0, 512); // <=512, contains a real keyword
    expect(atBound.length).toBeLessThanOrEqual(512);
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 61,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: atBound } },
    });
    expect(result(res).isError).toBeFalsy();
  });

  it("rejects a non-string query gracefully", () => {
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 62,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: 42 as unknown as string } },
    });
    const r = result(res);
    expect(r.isError).toBe(true);
    const text = (r.content as Array<{ type: string; text: string }>)[0].text;
    expect(text.toLowerCase()).toContain("must be a string");
  });

  it("rejects an unknown category before routing (graceful, names no internal term)", () => {
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 63,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: "best api", category: "image-generation" } },
    });
    const r = result(res);
    expect(r.isError).toBe(true);
    const text = (r.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("image-generation");
    expect(text.toLowerCase()).not.toContain("artefact");
  });
});

// HARDENING FIX 4: a JSON-RPC batch (array body) is mapped per entry, returning
// an array of responses; notifications produce no entry; an empty batch is a
// single -32600 Invalid Request.
describe("handleRpcBatch — JSON-RPC batch (FIX 4)", () => {
  it("maps each request to a response, in order", () => {
    const out = handleRpcBatch([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    expect(Array.isArray(out)).toBe(true);
    const arr = out as JsonRpcResponse[];
    expect(arr).toHaveLength(2);
    expect(arr[0].id).toBe(1);
    expect(arr[1].id).toBe(2);
    expect((arr[1].result as { tools: unknown[] }).tools).toHaveLength(1);
  });

  it("omits notification entries (no id) from the response array", () => {
    const out = handleRpcBatch([
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 5, method: "tools/list" },
    ]);
    const arr = out as JsonRpcResponse[];
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe(5);
  });

  it("returns an empty array when every entry is a notification", () => {
    const out = handleRpcBatch([{ jsonrpc: "2.0", method: "notifications/initialized" }]);
    expect(out).toEqual([]);
  });

  it("rejects an empty batch with a single -32600 Invalid Request", () => {
    const out = handleRpcBatch([]);
    expect(Array.isArray(out)).toBe(false);
    expect((out as JsonRpcResponse).error?.code).toBe(-32600);
  });
});

describe("tool-description + input zijn registry-gedreven (ADR 0010)", () => {
  it("somt elke geregistreerde categorie op, zonder hard-coded 'speech-to-text'", () => {
    for (const r of listCategories()) {
      expect(TOOL.description.toLowerCase()).toContain(r.label.toLowerCase());
    }
    expect(TOOL.description).not.toContain("speech-to-text");
  });

  it("toolDescription somt meerdere meegegeven categorieën netjes op", () => {
    expect(toolDescription(["Transcription", "Web search"])).toContain(
      "transcription and web search",
    );
  });

  it("adverteert een optionele category-input met de geregistreerde ids", () => {
    const props = TOOL.inputSchema.properties as Record<string, { enum?: readonly string[] }>;
    expect(props.category).toBeDefined();
    expect(props.category.enum).toContain("transcription");
    expect(TOOL.inputSchema.required).not.toContain("category"); // optional, query stays required
  });
});

describe("tools/call — expliciete category wint van detectie (ADR 0010)", () => {
  it("honoreert een expliciete, geregistreerde category", () => {
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: "best api for dutch", category: "transcription" } },
    });
    expect(result(res).isError).toBeFalsy();
  });

  it("geeft een tool-error voor een onbekende expliciete category", () => {
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query: "best api", category: "does-not-exist" } },
    });
    expect(result(res).isError).toBe(true);
  });
});

describe("outputSchema dekt het PUBLIEKe artefact (drift-guard)", () => {
  it("elke top-level required key bestaat op een echt geprojecteerd artefact", () => {
    const pub = toPublicArtefact(getArtefactByQuery(KNOWN_QUERY)!) as unknown as Record<
      string,
      unknown
    >;
    for (const key of PUBLIC_ARTEFACT_SCHEMA.required) {
      expect(pub[key]).toBeDefined();
    }
  });

  // FIX 7: outputSchema is advertised but never runtime-validated. Lightweight,
  // dependency-free check that a REAL projected artefact carries the key required
  // fields of the English schema — top-level plus the nested required keys on each
  // provider row, its price, the recommendation, and each source.
  it("een echt geprojecteerd artefact voldoet aan de geneste required-velden van het schema", () => {
    const pub = toPublicArtefact(getArtefactByQuery(KNOWN_QUERY)!);
    const props = PUBLIC_ARTEFACT_SCHEMA.properties;

    const providerRequired = props.providers.items.required;
    const priceRequired = props.providers.items.properties.price.required;
    for (const p of pub.providers) {
      const row = p as unknown as Record<string, unknown>;
      for (const key of providerRequired) expect(row[key]).toBeDefined();
      const price = p.price as unknown as Record<string, unknown>;
      for (const key of priceRequired) expect(price[key]).toBeDefined();
    }

    for (const key of props.recommendation.required) {
      expect((pub.recommendation as unknown as Record<string, unknown>)[key]).toBeDefined();
    }

    const sourceRequired = props.sources.items.required;
    for (const b of pub.sources) {
      const src = b as unknown as Record<string, unknown>;
      for (const key of sourceRequired) expect(src[key]).toBeDefined();
    }
  });
});

describe("clientInfoFrom \u2014 MCP client identity off the initialize handshake", () => {
  it("extracts name and version from initialize", () => {
    expect(
      clientInfoFrom({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "claude-desktop", version: "1.2.3" } },
      }),
    ).toBe("claude-desktop 1.2.3");
  });

  it("works without a version", () => {
    expect(
      clientInfoFrom({ method: "initialize", params: { clientInfo: { name: "cursor" } } }),
    ).toBe("cursor");
  });

  it("returns null for non-initialize methods and missing clientInfo", () => {
    expect(clientInfoFrom({ method: "tools/call", params: {} })).toBeNull();
    expect(clientInfoFrom({ method: "initialize", params: {} })).toBeNull();
    expect(clientInfoFrom(null)).toBeNull();
    expect(clientInfoFrom("initialize")).toBeNull();
    expect(
      clientInfoFrom({ method: "initialize", params: { clientInfo: { name: "" } } }),
    ).toBeNull();
  });

  it("bounds length and strips control characters (untrusted input)", () => {
    const long = "x".repeat(500);
    expect(
      clientInfoFrom({ method: "initialize", params: { clientInfo: { name: long } } })!.length,
    ).toBe(120);
    // Raw newline / ANSI-escape bytes in the reported name must not survive into
    // the DB or the admin UI verbatim.
    expect(
      clientInfoFrom({
        method: "initialize",
        params: { clientInfo: { name: "evil\nclient", version: "\u001b[31m1.0" } },
      }),
    ).toBe("evil client [31m1.0");
  });
});

// Telemetry (Sep 2026): 44 queries in 38 days asked for a head-to-head
// ("Cartesia Sonic vs ElevenLabs …") and got the generic category answer, and no
// caller could be identified or reached. The tool text now answers the pair and
// invites the caller to identify itself.
describe("tools/call head-to-head + feedback", () => {
  function text(query: string): string {
    const res = handleRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: TOOL.name, arguments: { query } },
    });
    const content = result(res).content as { text: string }[];
    return content[0].text;
  }

  it("leads with a head-to-head section and links the compare page for a two-provider question", () => {
    const t = text("Cartesia Sonic vs ElevenLabs for natural-sounding narration");
    expect(t).toContain("## Head-to-head");
    expect(t).toContain("/compare/tts/elevenlabs-vs-cartesia");
    // The full ranking still follows, so the contract view is unchanged.
    expect(t.indexOf("## Head-to-head")).toBeLessThan(t.indexOf("## Provider offerings"));
  });

  it("has no head-to-head section for a plain ranking question", () => {
    expect(text("best text-to-speech API")).not.toContain("## Head-to-head");
  });

  it("ends every answer with a feedback link and the x-api-key identity hint", () => {
    for (const t of [text("best text-to-speech API"), text("zzz qqq")]) {
      expect(t).toContain("github.com/Lodewijkheemskerk/syftly-mcp/issues");
      expect(t).toContain("x-api-key");
    }
  });
});
