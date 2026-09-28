import { describe, it, expect } from "vitest";
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

describe("buildDashboard", () => {
  it("folds the event window into the north-star panel", () => {
    // a + a (repeat) + b -> 3 calls, 2 unique, 1 repeat
    const data = buildDashboard([call("a"), call("a"), call("b")], 7);
    expect(data.windowDays).toBe(7);
    expect(data.northStar.totalCalls).toBe(3);
    expect(data.northStar.uniqueCallers).toBe(2);
    expect(data.northStar.repeatCallers).toBe(1);
  });

  it("includes the top-queries, category and endpoint panels", () => {
    const data = buildDashboard(
      [
        call("a", { query: "cheapest tts", category: "tts", endpoint: "answer", format: "json" }),
        call("b", { query: "cheapest tts", category: "tts", endpoint: "mcp", format: "mcp" }),
        call("c", { query: "best ocr", category: "ocr", endpoint: "answer", format: "md" }),
      ],
      30,
    );
    expect(data.topQueries[0]).toEqual({ query: "cheapest tts", count: 2 });
    expect(data.categories[0]).toEqual({ key: "tts", count: 2 });
    expect(data.endpoints.byEndpoint).toContainEqual({ key: "answer", count: 2 });
    expect(data.endpoints.byFormat).toContainEqual({ key: "mcp", count: 1 });
  });


  it("excludes self-tagged traffic and init handshakes from the usage panels", () => {
    const data = buildDashboard(
      [
        call("ip:stranger"),
        call("ip:stranger"),
        call("self:you"), // owner's tagged test call
        call("ip:scanner", { format: "init", query: "(initialize)", clientInfo: "scanner 1.0" }),
      ],
      30,
    );
    // North-star: only the stranger counts (2 calls, 1 unique, 1 repeat).
    expect(data.northStar.totalCalls).toBe(2);
    expect(data.northStar.uniqueCallers).toBe(1);
    expect(data.northStar.repeatCallers).toBe(1);
    // Liveness still sees everything.
    // (fixture timestamps are in the past, so calls24h stays 0 — that's fine)
    // The Callers panel lists all three, labeled.
    expect(data.callers).toHaveLength(3);
    const self = data.callers.find((c) => c.caller === "self:you")!;
    expect(self.self).toBe(true);
    const scanner = data.callers.find((c) => c.caller === "ip:scanner")!;
    expect(scanner.initOnly).toBe(true);
    expect(scanner.clients).toEqual(["scanner 1.0"]);
  });

  it("flags gap queries (no category match) and builds the trend", () => {
    const data = buildDashboard(
      [
        call("a", { query: "cheapest tts API", ts: "2026-06-20T08:00:00.000Z" }), // in scope
        call("b", { query: "image generation api", ts: "2026-06-20T09:00:00.000Z" }), // gap
        call("c", { query: "image generation api", ts: "2026-06-21T09:00:00.000Z" }), // gap
      ],
      30,
    );
    expect(data.gaps).toEqual([{ query: "image generation api", count: 2 }]);
    expect(data.trend).toEqual([
      { date: "2026-06-20", calls: 2, uniqueCallers: 2 },
      { date: "2026-06-21", calls: 1, uniqueCallers: 1 },
    ]);
  });
});

describe("buildDashboard consumers", () => {
  it("groups strangers' usage per likely consumer, without self or init rows", () => {
    const data = buildDashboard(
      [
        call("ip:a", { userAgent: "python-httpx/0.28.1" }),
        call("ip:b", { userAgent: "python-httpx/0.28.1" }),
        call("self:you", { userAgent: "curl" }),
        call("ip:scanner", { format: "init", query: "(initialize)", userAgent: "probe" }),
      ],
      7,
    );
    expect(data.consumers).toHaveLength(1);
    expect(data.consumers[0]).toMatchObject({ client: "python-httpx/0.28.1", calls: 2, ips: 2 });
  });
});
