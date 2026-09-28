import type { CallEvent } from "@/lib/events";
import { isSelfCaller } from "@/lib/caller";
import { EXAMPLE_QUERIES } from "@/lib/mcp";

// Normalized set of the documented example queries (lib/mcp.ts). Agents echo
// these verbatim when testing the tool; a full-string match (trimmed,
// case-insensitive) labels that as "echo" — a variation ("...for podcasts") is
// treated as a real question.
const ECHO_QUERIES = new Set(EXAMPLE_QUERIES.map((q) => q.trim().toLowerCase()));

/** True iff the query is a verbatim echo of a documented example query. */
export function isEchoQuery(query: string): boolean {
  return ECHO_QUERIES.has(query.trim().toLowerCase());
}

// The MVP-1 success metric (Q6): how many distinct callers issued >= minCalls
// calls. `repeatCallers` is the north-star ("does anyone come back?");
// `uniqueCallers` and `totalCalls` give it context. Pure over an event list so
// it is fully testable without a database — the Postgres store fetches a window
// via EventStore.since(), this folds it into the number.
export interface NorthStar {
  totalCalls: number;
  uniqueCallers: number;
  repeatCallers: number;
  minCalls: number;
}

/** One ranked bucket: a label and how many calls fell into it. */
export interface Tally {
  query: string;
  count: number;
}

/** A counted bucket keyed by an arbitrary label (category, endpoint, format). */
export interface KeyCount {
  key: string;
  count: number;
}

/** Count events by a derived key, busiest bucket first. Ties keep first-seen
 * order (Array.sort is stable). The shared core of the breakdown panels. */
function countBy(events: CallEvent[], keyOf: (e: CallEvent) => string): KeyCount[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const key = keyOf(e);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

/** Queries agents actually issued, most-asked first, capped at `limit`. Feeds
 * the query-set (ADR 0005): what to publish as etalage next. */
export function topQueries(events: CallEvent[], limit: number): Tally[] {
  return countBy(events, (e) => e.query)
    .map(({ key, count }) => ({ query: key, count }))
    .slice(0, limit);
}

/** Calls per category, busiest first. A null/blank category is bucketed as
 * "(uncategorized)" so nothing is silently dropped. */
export function categoryBreakdown(events: CallEvent[]): KeyCount[] {
  return countBy(events, (e) => e.category ?? "(uncategorized)");
}

/** Demand the catalogue can't answer: queries the classifier marks out-of-scope
 * (no category match), most-asked first. The `inScope` predicate is injected so
 * this stays decoupled from the category registry. Drives the next category. */
export function gapQueries(events: CallEvent[], inScope: (query: string) => boolean): Tally[] {
  const gaps = events.filter((e) => !inScope(e.query));
  return countBy(gaps, (e) => e.query).map(({ key, count }) => ({ query: key, count }));
}

/** Which channel agents reach for: split by endpoint (answer vs mcp) and by
 * format (json/md/mcp), each busiest first. */
export function endpointBreakdown(events: CallEvent[]): {
  byEndpoint: KeyCount[];
  byFormat: KeyCount[];
} {
  return {
    byEndpoint: countBy(events, (e) => e.endpoint),
    byFormat: countBy(events, (e) => e.format),
  };
}

/** One day on the adoption trend. */
export interface DayPoint {
  date: string; // YYYY-MM-DD (UTC)
  calls: number;
  uniqueCallers: number;
}

/** Calls and unique callers per UTC day, oldest first. Pure: the day comes from
 * each event's timestamp, so no clock is needed. */
export function timeline(events: CallEvent[]): DayPoint[] {
  const byDay = new Map<string, { calls: number; callers: Set<string> }>();
  for (const e of events) {
    const date = e.ts.slice(0, 10);
    const day = byDay.get(date) ?? { calls: 0, callers: new Set<string>() };
    day.calls++;
    day.callers.add(e.caller);
    byDay.set(date, day);
  }
  return [...byDay.entries()]
    .map(([date, d]) => ({ date, calls: d.calls, uniqueCallers: d.callers.size }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * How many calls landed in the last `hours` (default 24), measured against `now`.
 * A telemetry-liveness signal: if the pipeline silently dies, this drops to 0 even
 * while the longer window still shows history — so the dashboard can surface a
 * "nothing recorded recently" gap. Pure: `now` is injected so it's testable with a
 * fixed clock (defaults to the real clock for the page).
 */
export function callsInLastHours(events: CallEvent[], hours = 24, now: Date = new Date()): number {
  const cutoff = now.getTime() - hours * 3_600_000;
  return events.filter((e) => Date.parse(e.ts) >= cutoff).length;
}

/**
 * Events that count as real usage for the metrics. Excludes:
 * - the owner's self-tagged test traffic ("self:" callers) — the north-star is
 *   about STRANGERS coming back, not about us testing our own endpoint;
 * - initialize-handshake rows (format "init") — they signal that a client
 *   connected (visibility for the Callers panel), not that a question was asked;
 * - verbatim echoes of the documented example queries — an agent poking the tool
 *   with the advertised example is a connection test, not organic demand.
 */
export function usageEvents(events: CallEvent[]): CallEvent[] {
  return events.filter(
    (e) => e.format !== "init" && !isSelfCaller(e.caller) && !isEchoQuery(e.query),
  );
}

/** One caller as the dashboard sees them: how often, when, with which client. */
export interface CallerRow {
  caller: string;
  calls: number; // real usage calls (init excluded)
  initCalls: number; // initialize handshakes (connections, not questions)
  firstSeen: string;
  lastSeen: string;
  agents: string[]; // distinct user-agents, first-seen order
  clients: string[]; // distinct MCP clientInfo values, first-seen order
  queries: string[]; // most recent distinct usage queries, capped
  self: boolean; // the owner's tagged test traffic
  initOnly: boolean; // connected but never asked — scanner-shaped
  echoOnly: boolean; // only ever echoed documented examples — tester-shaped
}

/**
 * Group a window of events per caller, most recently seen first. This is the
 * "who is actually out there" panel: a stranger appearing here is the earliest
 * visible adoption signal, before the north-star moves. Self and init-only
 * callers are labeled instead of hidden, so the list stays complete and honest.
 */
export function callersBreakdown(events: CallEvent[], sampleLimit = 3): CallerRow[] {
  interface Acc {
    calls: number;
    initCalls: number;
    echoCalls: number;
    firstSeen: string;
    lastSeen: string;
    agents: Set<string>;
    clients: Set<string>;
    queries: string[]; // usage queries in time order
  }
  const byCaller = new Map<string, Acc>();
  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  for (const e of sorted) {
    const acc = byCaller.get(e.caller) ?? {
      calls: 0,
      initCalls: 0,
      echoCalls: 0,
      firstSeen: e.ts,
      lastSeen: e.ts,
      agents: new Set<string>(),
      clients: new Set<string>(),
      queries: [],
    };
    if (e.format === "init") acc.initCalls++;
    else {
      acc.calls++;
      if (isEchoQuery(e.query)) acc.echoCalls++;
      acc.queries.push(e.query);
    }
    if (e.ts < acc.firstSeen) acc.firstSeen = e.ts;
    if (e.ts > acc.lastSeen) acc.lastSeen = e.ts;
    if (e.userAgent) acc.agents.add(e.userAgent);
    if (e.clientInfo) acc.clients.add(e.clientInfo);
    byCaller.set(e.caller, acc);
  }
  return [...byCaller.entries()]
    .map(([caller, a]) => ({
      caller,
      calls: a.calls,
      initCalls: a.initCalls,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      agents: [...a.agents],
      clients: [...a.clients],
      // Most recent distinct queries: dedupe keeping the LAST occurrence, then
      // take the tail — "what did they ask lately", not "what did they ask first".
      queries: [...new Set(a.queries)]
        .filter((q) => a.queries.lastIndexOf(q) >= 0)
        .sort((x, y) => a.queries.lastIndexOf(x) - a.queries.lastIndexOf(y))
        .slice(-sampleLimit),
      self: isSelfCaller(caller),
      initOnly: a.calls === 0 && a.initCalls > 0,
      echoOnly: a.calls > 0 && a.echoCalls === a.calls,
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function northStar(events: CallEvent[], minCalls = 2): NorthStar {
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.caller, (counts.get(e.caller) ?? 0) + 1);
  }
  let repeatCallers = 0;
  for (const n of counts.values()) {
    if (n >= minCalls) repeatCallers++;
  }
  return {
    totalCalls: events.length,
    uniqueCallers: counts.size,
    repeatCallers,
    minCalls,
  };
}

/** One likely consumer: a self-named x-api-key, else one user-agent. */
export interface ClientGroupRow {
  client: string;
  calls: number;
  ips: number; // distinct caller ids folded into this group
  days: number; // distinct UTC days with a call — "came back" shows here
  firstSeen: string;
  lastSeen: string;
}

/**
 * Group (usage) events per likely consumer, most calls first. The per-IP caller
 * count over-counts a pipeline that rotates cloud IPs; this is the opposite
 * bound — it may merge strangers on the same HTTP library, but never inflates.
 * Read the two together.
 */
export function clientGroups(events: CallEvent[]): ClientGroupRow[] {
  const groups = new Map<string, { calls: number; ips: Set<string>; days: Set<string>; first: string; last: string }>();
  for (const e of events) {
    const client = e.caller.startsWith("key:") ? e.caller : (e.userAgent ?? "(no user-agent)");
    const g = groups.get(client) ?? { calls: 0, ips: new Set(), days: new Set(), first: e.ts, last: e.ts };
    g.calls++;
    g.ips.add(e.caller);
    g.days.add(e.ts.slice(0, 10));
    if (e.ts < g.first) g.first = e.ts;
    if (e.ts > g.last) g.last = e.ts;
    groups.set(client, g);
  }
  return [...groups.entries()]
    .map(([client, g]) => ({
      client,
      calls: g.calls,
      ips: g.ips.size,
      days: g.days.size,
      firstSeen: g.first,
      lastSeen: g.last,
    }))
    .sort((a, b) => b.calls - a.calls || a.firstSeen.localeCompare(b.firstSeen));
}
