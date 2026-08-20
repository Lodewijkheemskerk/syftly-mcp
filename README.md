# Syftly

**One MCP tool that answers: "which API should my agent use for this task?"**

Syftly is a hosted [Model Context Protocol](https://modelcontextprotocol.io) server with a single tool, `find_best_tool`. Your agent asks a question like *"cheapest transcription API with good accuracy"* or *"best web search API"* and gets a ranked, machine-readable answer computed from aggregated public benchmarks — provider table, prices, dated sources, and honest confidence labels.

Free, no signup, no affiliate links.

## Quick start

Claude Code:

```bash
claude mcp add --transport http syftly https://syftly.vercel.app/api/mcp
```

Cursor / Claude Desktop-style configs:

```json
{
  "mcpServers": {
    "syftly": {
      "type": "http",
      "url": "https://syftly.vercel.app/api/mcp"
    }
  }
}
```

Then ask your agent something like: *"Use Syftly to find the best OCR API for scanned PDFs."*

## What it answers

Five categories today:

| Category | Example query |
|---|---|
| Transcription (STT) | "cheapest transcription API with good accuracy" |
| Text-to-speech (TTS) | "most natural sounding TTS API" |
| Web search | "best web search API for agents" |
| Scraping | "scraping API that handles JavaScript rendering" |
| OCR / PDF | "best OCR API for scanned PDFs" |

Each answer includes a ranked provider table with prices and capabilities, the sources it was computed from (with dates), and an explicit confidence label: **hard-tested** (first-party measured) or **light estimate** (aggregated from public research, honestly labeled as such).

## How it works

- Rankings are computed per category from a fixed, versioned research recipe: source hierarchy → extraction → judgment → automated quality gates.
- Winners per decision axis (price, accuracy, latency, language coverage) are *computed* from structured provider fields, not hand-picked per query.
- Every answer is also published as a human-readable page: see [syftly.vercel.app](https://syftly.vercel.app) and the agent docs at [syftly.vercel.app/for-agents](https://syftly.vercel.app/for-agents).

## Development

Next.js app (App Router), plain CSS, Postgres for telemetry, Vitest for tests.

```bash
npm install
npm run dev     # http://localhost:3141
npm run check   # typecheck + lint + tests
```

## License

[MIT](./LICENSE)
