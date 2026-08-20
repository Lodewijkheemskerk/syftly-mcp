import type { Metadata } from "next";
import { canonical } from "@/lib/site";

// The "For agents" surface: how a machine consumes a Syftly answer. Documented
// HONESTLY against the real endpoints (lib/mcp + app/api/answer), not the design
// mockup's fictional names. The same Antwoord-artefact (ADR 0002) is served
// three ways — MCP tool, JSON, Markdown — each reusing the same citeerbare hap.

export const metadata: Metadata = {
  title: "For agents — Syftly",
  description:
    "Consume Syftly answers from your agent: an MCP tool over HTTP, raw JSON, or Markdown. Same answer, three ways.",
};

// Live, env-driven endpoints (lib/site canonical() → default https://syftly.vercel.app,
// swapped by one env var). The copy-paste blocks below MUST point at the real
// deployment so a reader can connect without editing anything first.
const MCP_URL = canonical("/api/mcp");
const ANSWER_URL = canonical("/api/answer");

// a) Claude Code CLI — one line adds Syftly as an HTTP MCP server.
const CLI_EXAMPLE = `claude mcp add --transport http syftly ${MCP_URL}`;

// b) Generic mcpServers config — the shape Cursor / Claude Desktop-style clients
//    read. `type: http` = the streamable-HTTP transport this endpoint speaks.
const CONFIG_EXAMPLE = `{
  "mcpServers": {
    "syftly": {
      "type": "http",
      "url": "${MCP_URL}"
    }
  }
}`;

// c) Raw JSON-RPC over HTTP, against the LIVE endpoint. Localhost stays only as a
//    secondary local-dev note so the primary example is copy-paste runnable.
const MCP_CURL = `curl -X POST "${MCP_URL}" \\
  -H 'content-type: application/json' \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "find_best_tool",
      "arguments": { "query": "Best transcription API for Dutch" }
    }
  }'

# → result.content[0].text   = the citable summary (verbatim)
#   result.structuredContent = the full answer artefact (matches outputSchema)
# Local dev: swap the host for http://localhost:3000`;

// The whole artefact as JSON. Response keys are English (summary/confidence/
// updated/name/price/sources) — the public machine contract.
const JSON_EXAMPLE = `curl "${ANSWER_URL}?query=best-transcription-api-for-dutch"

{
  "query": "Best transcription API for Dutch",
  "confidence": "light estimate",
  "updated": "2026-06-19",
  "recommendation": { "default": "ElevenLabs Scribe v2", "axes": { … } },
  "providers": [ { "name": "ElevenLabs Scribe v2",
                   "price": { "value": …, "unit": "$/1000min" },
                   "strengths": …, "weaknesses": … } ],
  "sources": [ … ]
}`;

const MD_EXAMPLE = `curl "${ANSWER_URL}?query=best-transcription-api-for-dutch&format=md"

# Best transcription API for Dutch

**Confidence:** light estimate · **Last updated:** 2026-06-19

For Dutch speech-to-text, ElevenLabs Scribe v2 tops the leaderboard …

## Provider offerings

| Offering | Provider | Price | Strong | Weak | Source |
| --- | --- | --- | --- | --- | --- |
| ElevenLabs Scribe v2 | ElevenLabs | 0.4 $/1000min | … | … | Artificial Analysis (2026-06-10) |`;

export default function Page() {
  return (
    <main className="agents">
      <div className="answer-meta">
        <span className="trust-badge">
          <span className="trust-dot" />
          for agents
        </span>
        <span className="meta-mono">MCP · JSON · Markdown</span>
      </div>

      <h1>Built to be read by machines</h1>
      <p className="hap">
        Every Syftly answer is one object — a citable summary, a provider table, dated
        sources and a confidence label — served three ways. Pick the one your agent speaks.
        Each returns the exact same answer; only the envelope differs.
      </p>

      {/* Connect — copy-paste config against the LIVE endpoint, so a reader is
          talking to Syftly before reading any of the reference below. */}
      <div className="section-label">
        <span>Connect</span>
        <span className="rule" />
      </div>
      <p className="endpoint-lede">
        Point your MCP client at the live endpoint (<code className="inline">{MCP_URL}</code>) —
        nothing to run or host. Two ways to register it:
      </p>
      <p className="config-label">Claude Code (CLI)</p>
      <pre className="code">
        <code>{CLI_EXAMPLE}</code>
      </pre>
      <p className="config-label">Cursor / Claude Desktop-style config</p>
      <pre className="code">
        <code>{CONFIG_EXAMPLE}</code>
      </pre>
      <p className="endpoint-note">
        Honest limitation: pull-only today — no SSE stream or session id yet. Strict connector
        clients that require streaming aren&apos;t supported until that lands (cheap to add).
      </p>

      {/* 1 — MCP tool over HTTP */}
      <div className="section-label">
        <span>1 · MCP tool</span>
        <span className="rule" />
      </div>
      <div className="endpoint-head">
        <span className="method-badge">POST</span>
        <code className="endpoint-path">/api/mcp</code>
      </div>
      <p className="endpoint-lede">
        An MCP tool over Streamable HTTP (stateless JSON-RPC 2.0). One tool,{" "}
        <code className="inline">find_best_tool</code>: pass a natural-language question, get
        the ranked recommendation as structured output. Standard methods{" "}
        <code className="inline">initialize</code> and <code className="inline">tools/list</code>{" "}
        work too.
      </p>
      <pre className="code">
        <code>{MCP_CURL}</code>
      </pre>

      {/* 2 — JSON */}
      <div className="section-label">
        <span>2 · JSON</span>
        <span className="rule" />
      </div>
      <div className="endpoint-head">
        <span className="method-badge">GET</span>
        <code className="endpoint-path">/api/answer?query=</code>
      </div>
      <p className="endpoint-lede">
        The whole answer artefact as JSON. Query by the natural question or its slug; 404 if
        no answer is published yet.
      </p>
      <pre className="code">
        <code>{JSON_EXAMPLE}</code>
      </pre>

      {/* 3 — Markdown */}
      <div className="section-label">
        <span>3 · Markdown</span>
        <span className="rule" />
      </div>
      <div className="endpoint-head">
        <span className="method-badge">GET</span>
        <code className="endpoint-path">/api/answer?query=…&amp;format=md</code>
      </div>
      <p className="endpoint-lede">
        The same answer as Markdown (<code className="inline">text/markdown</code>), ready to drop
        straight into a context window.
      </p>
      <pre className="code">
        <code>{MD_EXAMPLE}</code>
      </pre>

      <div className="agents-callout">
        Every answer carries a confidence label. Transcription today is a{" "}
        <strong>light estimate</strong>: aggregated from public benchmarks (with sources and
        dates), not first-hand Syftly measurement.
      </div>
    </main>
  );
}
