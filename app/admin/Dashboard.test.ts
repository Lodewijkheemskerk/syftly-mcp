import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Dashboard from "@/app/admin/Dashboard";
import { buildDashboard } from "@/lib/dashboard";
import type { CallEvent } from "@/lib/events";

function call(caller: string, over: Partial<CallEvent> = {}): CallEvent {
  return {
    ts: "2026-06-23T10:00:00.000Z",
    endpoint: "answer",
    format: "json",
    category: "transcription",
    query: "q",
    caller,
    userAgent: null,
    ...over,
  };
}

describe("Dashboard view", () => {
  it("shows the north-star numbers and the window", () => {
    const data = buildDashboard([call("a"), call("a"), call("b")], 7);
    const html = renderToStaticMarkup(Dashboard({ data }));
    expect(html).toContain("3"); // total calls
    expect(html).toContain("2"); // unique callers
    expect(html).toContain("1"); // repeat callers (the north-star)
    expect(html.toLowerCase()).toContain("repeat"); // the load-bearing metric is labelled
    expect(html).toContain("7"); // window days
    expect(html).toContain("Calls (24h)"); // telemetry-liveness readout is present
  });

  it("shows the top-queries, category and endpoint panels", () => {
    const data = buildDashboard(
      [
        call("a", { query: "cheapest tts", category: "tts", endpoint: "answer", format: "json" }),
        call("b", { query: "best ocr", category: "ocr", endpoint: "mcp", format: "mcp" }),
      ],
      30,
    );
    const html = renderToStaticMarkup(Dashboard({ data }));
    expect(html).toContain("cheapest tts"); // a real asked query
    expect(html).toContain("best ocr");
    expect(html).toContain("tts"); // category bucket
    expect(html).toContain("ocr");
    expect(html).toContain("answer"); // endpoint split
    expect(html.toLowerCase()).toContain("queries"); // top-queries panel heading
  });


  it("shows the Callers panel with labels for self and init-only callers", () => {
    const data = buildDashboard(
      [
        call("ip:stranger", { userAgent: "python-httpx/0.28.1", query: "best ocr api" }),
        call("self:you"),
        call("ip:scanner", { format: "init", query: "(initialize)", clientInfo: "glama-scanner 2.1" }),
      ],
      30,
    );
    const html = renderToStaticMarkup(Dashboard({ data }));
    expect(html.toLowerCase()).toContain("callers"); // panel heading
    expect(html).toContain("python-httpx/0.28.1"); // the stranger's client
    expect(html).toContain("glama-scanner 2.1"); // MCP clientInfo surfaces
    expect(html).toContain("you"); // self badge
    expect(html).toContain("init-only"); // scanner badge
    expect(html).toContain("best ocr api"); // recent query sample
  });


  it("collapses init-only scanners behind a details summary, real callers in the main table", () => {
    const data = buildDashboard(
      [
        call("ip:stranger", { query: "best ocr api" }),
        call("ip:scanner1", { format: "init", query: "(initialize)", clientInfo: "probe-a 1.0" }),
        call("ip:scanner2", { format: "init", query: "(initialize)", clientInfo: "probe-b 1.0" }),
      ],
      30,
    );
    const html = renderToStaticMarkup(Dashboard({ data }));
    expect(html).toContain("<details");
    expect(html).toContain("2 init-only scanners");
    // The real caller is NOT inside the details block (appears before it).
    expect(html.indexOf("ip:stranger")).toBeLessThan(html.indexOf("<details"));
  });

  it("shows gap queries and the trend", () => {
    const data = buildDashboard(
      [
        call("a", { query: "image generation api", ts: "2026-06-20T08:00:00.000Z" }), // gap
        call("b", { query: "cheapest tts API", ts: "2026-06-21T08:00:00.000Z" }), // in scope
      ],
      30,
    );
    const html = renderToStaticMarkup(Dashboard({ data }));
    expect(html).toContain("image generation api"); // the gap is surfaced
    expect(html.toLowerCase()).toContain("gap"); // gap panel heading
    expect(html).toContain("2026-06-20"); // a trend day
    expect(html.toLowerCase()).toContain("trend"); // trend panel heading
  });
});
