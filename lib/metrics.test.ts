import { describe, it, expect } from "vitest";
import { northStar, topQueries, categoryBreakdown, endpointBreakdown, gapQueries, timeline, callsInLastHours, usageEvents, callersBreakdown, isEchoQuery, clientGroups } from "@/lib/metrics";
import type { CallEvent } from "@/lib/events";

function ev(over: Partial<CallEvent>): CallEvent {
  return {
    ts: "2026-06-22T10:00:00.000Z",
    endpoint: "answer",
    format: "json",
    category: "transcription",
    query: "q",
    caller: "c",
    userAgent: "ua",
    ...over,
  };
}

function call(caller: string, ts = "2026-06-22T10:00:00.000Z"): CallEvent {
  return {
    ts,
    endpoint: "answer",
    format: "json",
    category: "transcription",
    query: "q",
    caller,
    userAgent: "ua",
  };
}

// MVP-1 success metric (Q6): distinct callers that came back (>= minCalls).
describe("northStar — MVP-1 succesmetriek (Q6)", () => {
  it("lege lijst geeft nullen", () => {
    expect(northStar([])).toEqual({
      totalCalls: 0,
      uniqueCallers: 0,
      repeatCallers: 0,
      minCalls: 2,
    });
  });

  it("telt unieke callers en totale calls", () => {
    const m = northStar([call("a"), call("b"), call("a")]);
    expect(m.uniqueCallers).toBe(2);
    expect(m.totalCalls).toBe(3);
  });

  it("telt alleen callers met >= minCalls als repeat", () => {
    const m = northStar([call("a"), call("a"), call("b")]);
    expect(m.repeatCallers).toBe(1); // a heeft 2 calls, b heeft er 1
  });

  it("respecteert een aangepaste drempel", () => {
    const m = northStar([call("a"), call("a"), call("a"), call("b"), call("b")], 3);
    expect(m.repeatCallers).toBe(1); // alleen a haalt 3
    expect(m.minCalls).toBe(3);
  });
});

// Telemetry-liveness: how many calls in the last N hours. A silent pipeline
// failure makes this 0 while the longer history still shows data.
describe("callsInLastHours", () => {
  const now = new Date("2026-06-22T12:00:00.000Z");

  it("counts only events within the window, measured against the injected now", () => {
    const events = [
      ev({ ts: "2026-06-22T11:30:00.000Z" }), // 30m ago — in
      ev({ ts: "2026-06-21T13:00:00.000Z" }), // 23h ago — in
      ev({ ts: "2026-06-21T11:00:00.000Z" }), // 25h ago — out
      ev({ ts: "2026-06-20T12:00:00.000Z" }), // 48h ago — out
    ];
    expect(callsInLastHours(events, 24, now)).toBe(2);
  });

  it("is 0 when no calls fall in the window (the silent-failure signal)", () => {
    const events = [ev({ ts: "2026-06-01T12:00:00.000Z" })];
    expect(callsInLastHours(events, 24, now)).toBe(0);
  });

  it("is 0 for an empty event list", () => {
    expect(callsInLastHours([], 24, now)).toBe(0);
  });

  it("respects a custom window", () => {
    const events = [ev({ ts: "2026-06-22T10:00:00.000Z" })]; // 2h ago
    expect(callsInLastHours(events, 1, now)).toBe(0);
    expect(callsInLastHours(events, 3, now)).toBe(1);
  });
});

// What are agents actually asking? Feeds the query-set (ADR 0005).
describe("topQueries", () => {
  it("ranks queries by call count, most-asked first, limited", () => {
    const events = [
      ev({ query: "cheapest tts" }),
      ev({ query: "cheapest tts" }),
      ev({ query: "cheapest tts" }),
      ev({ query: "best ocr" }),
      ev({ query: "best ocr" }),
      ev({ query: "dutch transcription" }),
    ];
    expect(topQueries(events, 2)).toEqual([
      { query: "cheapest tts", count: 3 },
      { query: "best ocr", count: 2 },
    ]);
  });

  it("returns an empty list for no events", () => {
    expect(topQueries([], 10)).toEqual([]);
  });
});

// Which category breadth is actually getting used (ADR 0010 breadth bet).
describe("categoryBreakdown", () => {
  it("counts calls per category, busiest first", () => {
    const events = [
      ev({ category: "tts" }),
      ev({ category: "tts" }),
      ev({ category: "ocr" }),
      ev({ category: "scraping" }),
      ev({ category: "ocr" }),
    ];
    expect(categoryBreakdown(events)).toEqual([
      { key: "tts", count: 2 },
      { key: "ocr", count: 2 },
      { key: "scraping", count: 1 },
    ]);
  });

  it("buckets a missing category as uncategorized", () => {
    expect(categoryBreakdown([ev({ category: null })])).toEqual([
      { key: "(uncategorized)", count: 1 },
    ]);
  });
});

// Which channel agents reach for: endpoint (answer vs mcp) and format (json/md/mcp).
describe("endpointBreakdown", () => {
  it("splits calls by endpoint and by format, busiest first", () => {
    const events = [
      ev({ endpoint: "answer", format: "json" }),
      ev({ endpoint: "answer", format: "md" }),
      ev({ endpoint: "answer", format: "json" }),
      ev({ endpoint: "mcp", format: "mcp" }),
    ];
    const b = endpointBreakdown(events);
    expect(b.byEndpoint).toEqual([
      { key: "answer", count: 3 },
      { key: "mcp", count: 1 },
    ]);
    expect(b.byFormat).toEqual([
      { key: "json", count: 2 },
      { key: "md", count: 1 },
      { key: "mcp", count: 1 },
    ]);
  });
});

// Demand the catalogue can't answer: queries that match no category. The classifier
// is injected so metrics stays decoupled from the category registry.
describe("gapQueries", () => {
  it("ranks out-of-scope queries (no category match) by count", () => {
    const inScope = (q: string) => q.includes("tts") || q.includes("ocr");
    const events = [
      ev({ query: "cheapest tts" }),
      ev({ query: "image generation api" }),
      ev({ query: "image generation api" }),
      ev({ query: "best ocr" }),
      ev({ query: "translate text api" }),
    ];
    expect(gapQueries(events, inScope)).toEqual([
      { query: "image generation api", count: 2 },
      { query: "translate text api", count: 1 },
    ]);
  });
});

// The adoption trend: calls and unique callers per day, oldest first.
describe("timeline", () => {
  it("buckets events by UTC day, calls + unique callers, chronological", () => {
    const events = [
      ev({ ts: "2026-06-21T10:00:00.000Z", caller: "b" }),
      ev({ ts: "2026-06-20T08:00:00.000Z", caller: "a" }),
      ev({ ts: "2026-06-20T09:30:00.000Z", caller: "a" }),
      ev({ ts: "2026-06-20T11:00:00.000Z", caller: "c" }),
    ];
    expect(timeline(events)).toEqual([
      { date: "2026-06-20", calls: 3, uniqueCallers: 2 },
      { date: "2026-06-21", calls: 1, uniqueCallers: 1 },
    ]);
  });

  it("is empty for no events", () => {
    expect(timeline([])).toEqual([]);
  });
});

// Usage filtering: the north-star is about STRANGERS asking questions, so the
// owner's self-tagged traffic and initialize-handshake rows don't count.
// Documented example queries get echoed verbatim by agents/scanners testing the
// tool (observed: 65x "best transcription API for Dutch" from 51 callers). They
// are labeled "echo" and excluded from the usage metrics, like self-traffic.
describe("echo queries", () => {
  it("isEchoQuery matches a documented example verbatim, trimmed, case-insensitive", () => {
    expect(isEchoQuery("best transcription API for Dutch")).toBe(true);
    expect(isEchoQuery("  Best Transcription API for Dutch  ")).toBe(true);
    expect(isEchoQuery("best transcription API for Dutch podcasts")).toBe(false);
    expect(isEchoQuery("best OCR API for invoices")).toBe(false);
  });

  it("also matches the slug-form curl example from the for-agents page", () => {
    expect(isEchoQuery("best-transcription-api-for-dutch")).toBe(true);
  });

  it("usageEvents filters echoes of documented examples", () => {
    const events = [
      ev({ query: "best transcription API for Dutch", caller: "a" }),
      ev({ query: "best OCR API for invoices", caller: "b" }),
    ];
    const usage = usageEvents(events);
    expect(usage).toHaveLength(1);
    expect(usage[0].caller).toBe("b");
  });

  it("callersBreakdown labels callers whose usage calls are ALL echoes", () => {
    const rows = callersBreakdown([
      ev({ query: "best transcription API for Dutch", caller: "echoer" }),
      ev({ query: "best transcription API for Dutch", caller: "real" }),
      ev({ query: "best OCR API for invoices", caller: "real" }),
      ev({ format: "init", query: "", caller: "scanner" }),
    ]);
    const byCaller = Object.fromEntries(rows.map((r) => [r.caller, r]));
    expect(byCaller.echoer.echoOnly).toBe(true);
    expect(byCaller.real.echoOnly).toBe(false);
    expect(byCaller.scanner.echoOnly).toBe(false); // init-only, not echo-only
  });
});

describe("usageEvents", () => {
  it("filters out self-tagged callers and init events", () => {
    const events = [
      ev({ caller: "ip:aaa" }),
      ev({ caller: "self:you" }),
      ev({ caller: "ip:bbb", format: "init", query: "(initialize)" }),
      ev({ caller: "key:k1" }),
    ];
    const usage = usageEvents(events);
    expect(usage.map((e) => e.caller)).toEqual(["ip:aaa", "key:k1"]);
  });
});

// The Callers panel: who is actually out there, one row per caller, most
// recently seen first — self and init-only (scanner-like) callers labeled.
describe("callersBreakdown", () => {
  it("groups per caller with counts, first/last seen, agents and clients", () => {
    const events = [
      ev({ caller: "ip:aaa", ts: "2026-07-01T10:00:00.000Z", userAgent: "python-httpx/0.28.1", query: "best ocr api" }),
      ev({ caller: "ip:aaa", ts: "2026-07-02T10:00:00.000Z", userAgent: "python-httpx/0.28.1", query: "cheapest tts" }),
      ev({
        caller: "ip:aaa",
        ts: "2026-07-01T09:59:00.000Z",
        format: "init",
        query: "(initialize)",
        userAgent: "python-httpx/0.28.1",
        clientInfo: "cursor 0.9",
      }),
    ];
    const [row] = callersBreakdown(events);
    expect(row.caller).toBe("ip:aaa");
    expect(row.calls).toBe(2); // usage calls, init excluded
    expect(row.initCalls).toBe(1);
    expect(row.firstSeen).toBe("2026-07-01T09:59:00.000Z");
    expect(row.lastSeen).toBe("2026-07-02T10:00:00.000Z");
    expect(row.agents).toEqual(["python-httpx/0.28.1"]);
    expect(row.clients).toEqual(["cursor 0.9"]);
    expect(row.queries).toEqual(["best ocr api", "cheapest tts"]);
    expect(row.self).toBe(false);
    expect(row.initOnly).toBe(false);
  });

  it("sorts most recently seen first and labels self + init-only callers", () => {
    const events = [
      ev({ caller: "self:you", ts: "2026-07-05T10:00:00.000Z" }),
      ev({ caller: "ip:scanner", ts: "2026-07-06T10:00:00.000Z", format: "init", query: "(initialize)", clientInfo: "some-scanner 1.0" }),
      ev({ caller: "ip:old", ts: "2026-07-01T10:00:00.000Z" }),
    ];
    const rows = callersBreakdown(events);
    expect(rows.map((r) => r.caller)).toEqual(["ip:scanner", "self:you", "ip:old"]);
    expect(rows[0].initOnly).toBe(true);
    expect(rows[1].self).toBe(true);
    expect(rows[2].initOnly).toBe(false);
  });

  it("caps sample queries at the limit, keeping the most recent, deduped", () => {
    const events = ["a", "b", "a", "c", "d"].map((q, i) =>
      ev({ caller: "ip:x", query: q, ts: `2026-07-0${i + 1}T10:00:00.000Z` }),
    );
    const [row] = callersBreakdown(events, 3);
    expect(row.queries).toEqual(["a", "c", "d"]); // most recent 3 distinct
  });
});

// Sep 2026: one pipeline rotating cloud IPs showed up as 56 "unique callers".
// Grouping usage per self-named key, else per user-agent, gives the opposite
// bound: it can merge strangers on the same HTTP library, but never inflates.
describe("clientGroups", () => {
  it("groups usage by x-api-key name, else by user-agent, counting IPs and active days", () => {
    const events = [
      ev({ caller: "ip:a", userAgent: "python-httpx/0.28.1", ts: "2026-09-22T02:00:00.000Z", query: "q1" }),
      ev({ caller: "ip:b", userAgent: "python-httpx/0.28.1", ts: "2026-09-22T03:00:00.000Z", query: "q2" }),
      ev({ caller: "ip:c", userAgent: "python-httpx/0.28.1", ts: "2026-09-24T04:00:00.000Z", query: "q3" }),
      ev({ caller: "key:acme-pipeline", userAgent: "node", ts: "2026-09-23T10:00:00.000Z", query: "q4" }),
      ev({ caller: "ip:d", userAgent: null, ts: "2026-09-23T11:00:00.000Z", query: "q5" }),
    ];
    expect(clientGroups(events)).toEqual([
      { client: "python-httpx/0.28.1", calls: 3, ips: 3, days: 2, firstSeen: "2026-09-22T02:00:00.000Z", lastSeen: "2026-09-24T04:00:00.000Z" },
      { client: "key:acme-pipeline", calls: 1, ips: 1, days: 1, firstSeen: "2026-09-23T10:00:00.000Z", lastSeen: "2026-09-23T10:00:00.000Z" },
      { client: "(no user-agent)", calls: 1, ips: 1, days: 1, firstSeen: "2026-09-23T11:00:00.000Z", lastSeen: "2026-09-23T11:00:00.000Z" },
    ]);
  });
});
