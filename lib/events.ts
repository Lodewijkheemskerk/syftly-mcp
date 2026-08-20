// Call telemetry for the north-star metric (Q6). One CallEvent per endpoint
// call. The store is an interface so the pure aggregation (lib/metrics) is
// testable against an in-memory implementation, while production writes to
// Postgres (Supabase). Telemetry is fire-and-forget at the call site: it must
// never fail or slow the actual answer.
export interface CallEvent {
  ts: string; // ISO timestamp of the call (UTC, sorts lexicographically)
  endpoint: string; // "answer" | "mcp"
  format: string; // "json" | "md" | "mcp"
  category: string | null; // resolved category, if known
  query: string;
  caller: string; // callerId: "key:<k>", "ip:<hash>" or "self:you"
  userAgent: string | null;
  // MCP client identity from the initialize handshake ("<name> <version>"),
  // when the event is an initialize; null/absent otherwise. Optional so
  // existing constructors and stored rows stay valid.
  clientInfo?: string | null;
}

export interface EventStore {
  record(event: CallEvent): Promise<void>;
  // All events at or after the given ISO date, for windowed metrics.
  since(isoDate: string): Promise<CallEvent[]>;
}

// In-memory store for tests and local dev. Does NOT persist across processes,
// so serverless production needs the Postgres store for real measurement.
export function createMemoryStore(): EventStore {
  const events: CallEvent[] = [];
  return {
    async record(event) {
      events.push(event);
    },
    async since(isoDate) {
      return events.filter((e) => e.ts >= isoDate);
    },
  };
}
