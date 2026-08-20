import postgres from "postgres";
import type { CallEvent, EventStore } from "@/lib/events";

// Postgres (Supabase) implementation of EventStore. Uses the transaction pooler
// (prepare:false, SSL required) — see db/schema.sql for the matching table. The
// connection is a lazy singleton so this module can be imported without a
// DATABASE_URL: builds/tests/local dev fall back to the in-memory store via
// event-store.ts, and we only touch the database when something is recorded.
type Sql = ReturnType<typeof postgres>;
let sql: Sql | null = null;

// An optional connectionString lets tests point at a throwaway TEST_DATABASE_URL
// without ever falling back to the production DATABASE_URL. Production callers
// pass nothing and get the env var.
function getSql(connectionString?: string): Sql {
  if (!sql) {
    const url = connectionString ?? process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // max:4 — telemetry is fire-and-forget behind the Supabase transaction
    // pooler, and Fluid Compute reuses instances, so a small cap keeps us from
    // hogging pooler slots (the default of 10 is generous for a write-mostly
    // sidecar). prepare:false + ssl:'require' are required by the pooler.
    sql = postgres(url, { prepare: false, ssl: "require", max: 4 });
  }
  return sql;
}

interface EventRow {
  ts: Date;
  endpoint: string;
  format: string;
  category: string | null;
  query: string;
  caller: string;
  user_agent: string | null;
  client_info: string | null;
}

function toEvent(r: EventRow): CallEvent {
  return {
    ts: r.ts.toISOString(),
    endpoint: r.endpoint,
    format: r.format,
    category: r.category,
    query: r.query,
    caller: r.caller,
    userAgent: r.user_agent,
    clientInfo: r.client_info,
  };
}

export function createPostgresStore(connectionString?: string): EventStore {
  return {
    async record(e) {
      const db = getSql(connectionString);
      await db`
        insert into events (ts, endpoint, format, category, query, caller, user_agent, client_info)
        values (${e.ts}, ${e.endpoint}, ${e.format}, ${e.category}, ${e.query}, ${e.caller}, ${e.userAgent}, ${e.clientInfo ?? null})
      `;
    },
    async since(isoDate) {
      const db = getSql(connectionString);
      const rows = await db<EventRow[]>`
        select ts, endpoint, format, category, query, caller, user_agent, client_info
        from events
        where ts >= ${isoDate}
        order by ts
      `;
      return rows.map(toEvent);
    },
  };
}
