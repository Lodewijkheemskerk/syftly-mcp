import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "@/app/for-agents/page";
import { TOOL } from "@/lib/mcp";

// The "For agents" page documents how an agent consumes Syftly. Its whole job is
// to be HONEST to the real endpoints — so the test pins it to the code, not to
// the design mockup's fictional names (get_answer / npx @syftly/mcp / .json).
function render(): string {
  return renderToStaticMarkup(Page());
}

describe("For agents page", () => {
  const html = render();

  it("documents the three real consumption surfaces", () => {
    expect(html).toContain("/api/mcp"); // MCP over HTTP
    expect(html).toContain("/api/answer?query="); // JSON
    expect(html).toContain("format=md"); // Markdown
  });

  it("uses the real MCP tool name from lib/mcp (find_best_tool)", () => {
    expect(TOOL.name).toBe("find_best_tool");
    expect(html).toContain("find_best_tool");
    expect(html).toContain("tools/call"); // the real JSON-RPC method
  });

  it("uses a real, published query so the examples actually work", () => {
    expect(html).toContain("Best transcription API for Dutch");
  });

  it("does NOT leak the design mockup's fictional names", () => {
    expect(html).not.toContain("get_answer");
    expect(html).not.toContain("@syftly/mcp");
    expect(html).not.toContain("answer.json");
  });

  it("is honest about the MCP limitation (pull-only, no SSE/session yet)", () => {
    expect(html.toLowerCase()).toContain("pull-only");
  });

  it("ships copy-paste connect config against the LIVE endpoint", () => {
    // a) Claude Code CLI one-liner
    expect(html).toContain("claude mcp add --transport http syftly");
    // b) generic mcpServers JSON block
    expect(html).toContain("mcpServers");
    expect(html).toContain("&quot;type&quot;: &quot;http&quot;");
    // Live host, not a localhost placeholder, in the primary examples.
    expect(html).toContain("syftly.vercel.app/api/mcp");
    // The old $SYFTLY shell placeholder is gone from the primary blocks.
    expect(html).not.toContain("$SYFTLY");
  });

  it("puts the pull-only limitation BELOW the connect config blocks", () => {
    const cliIdx = html.indexOf("claude mcp add");
    const configIdx = html.indexOf("mcpServers");
    const noteIdx = html.toLowerCase().indexOf("pull-only");
    expect(cliIdx).toBeGreaterThan(-1);
    expect(configIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeGreaterThan(cliIdx);
    expect(noteIdx).toBeGreaterThan(configIdx);
  });

  it("keeps internal Dutch jargon out of the public copy", () => {
    expect(html.toLowerCase()).not.toContain("citeerbare");
    expect(html.toLowerCase()).not.toContain("etalage");
  });

  it("uses English machine-contract keys in the JSON response example (not Dutch)", () => {
    expect(html).toContain("&quot;confidence&quot;");
    expect(html).toContain("&quot;updated&quot;");
    expect(html).toContain("&quot;sources&quot;");
    expect(html).toContain("&quot;price&quot;");
    // Dutch artefact keys must not leak into the public example.
    expect(html).not.toContain("zekerheidslabel");
    expect(html).not.toContain("laatst_bijgewerkt");
    expect(html).not.toContain("bronnen");
  });
});
