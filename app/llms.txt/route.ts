import { listCategories } from "@/lib/categories";
import { getArtefact, listEtalage } from "@/lib/artefact";
import { canonical } from "@/lib/site";

// llms.txt (llmstxt.org): the AI-crawler index of the citeable surface. Like
// the sitemap it is registry-derived — only the curated etalage is listed, so
// the manifest can never drift from what actually exists (ADR 0009 guardrail:
// no engine long-tail in any crawl manifest).
export const dynamic = "force-static";

function answerLines(category: string): string[] {
  return listEtalage()
    .filter((e) => e.category === category)
    .map(({ category: cat, query }) => {
      const artefact = getArtefact(cat, query);
      return artefact ? `- [${artefact.query}](${canonical(`/${cat}/${query}`)})` : null;
    })
    .filter((l): l is string => l !== null);
}

export async function GET(): Promise<Response> {
  const sections = listCategories().map((r) =>
    [`## Answers: ${r.category}`, ...answerLines(r.category)].join("\n"),
  );

  const text = [
    "# Syftly",
    "",
    "> Ranks the best AI tool or API per task — transcription, text-to-speech, web search, scraping and OCR. Every answer is computed from aggregated public benchmarks and comes with a provider table, prices, dated sources and an honest confidence label. Free, no signup.",
    "",
    `Syftly is also an MCP server: connect at ${canonical("/api/mcp")} (streamable HTTP, no auth). One tool: \`find_best_tool\` — ask it "what's the best/cheapest API for [task]" and get the same ranked answer machine-readable.`,
    "",
    ...sections,
    "",
    "## Docs",
    `- [For agents](${canonical("/for-agents")}): how to wire Syftly into an agent (MCP + plain HTTP)`,
    `- [Methodology](${canonical("/methodology")}): how rankings are computed and labeled`,
    `- [Categories](${canonical("/categories")}): every covered category`,
    "",
  ].join("\n");

  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
