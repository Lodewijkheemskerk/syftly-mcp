import { describe, it, expect } from "vitest";
import { GET } from "@/app/llms.txt/route";
import { listEtalage, getArtefact } from "@/lib/artefact";
import { canonical } from "@/lib/site";

// llms.txt is the AI-crawler index (llmstxt.org): a markdown manifest of the
// citeable surface. Same registry-derived invariant as the sitemap — every
// etalage page is listed, nothing else is, so it can never drift.
async function body(): Promise<string> {
  const res = await GET();
  expect(res.headers.get("content-type")).toContain("text/plain");
  return res.text();
}

describe("llms.txt", () => {
  it("opent met de site-naam en een samenvattende blockquote", async () => {
    const text = await body();
    expect(text).toMatch(/^# Syftly/);
    expect(text).toMatch(/\n> /);
  });

  it("noemt het MCP-endpoint met transport en toolnaam", async () => {
    const text = await body();
    expect(text).toContain("https://syftly.vercel.app/api/mcp");
    expect(text).toContain("find_best_tool");
  });

  it("bevat elke etalage-pagina als markdown-link met de menselijke vraag", async () => {
    const text = await body();
    const etalage = listEtalage();
    expect(etalage.length).toBeGreaterThan(0);
    for (const { category, query } of etalage) {
      const artefact = getArtefact(category, query)!;
      expect(text).toContain(`[${artefact.query}](${canonical(`/${category}/${query}`)})`);
    }
  });

  it("bevat de statische docs-pagina's", async () => {
    const text = await body();
    for (const p of ["/for-agents", "/methodology", "/categories"]) {
      expect(text).toContain(canonical(p));
    }
  });
});
