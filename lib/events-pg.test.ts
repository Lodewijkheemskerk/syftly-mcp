import { describe, it, expect, vi } from "vitest";
import { createPostgresStore } from "@/lib/events-pg";
import type { CallEvent } from "@/lib/events";

// SAFETY: these unit tests must never open a real connection. The store's
// getSql() is lazy (only fires inside record/since), so building the store is
// side-effect-free, and the one test that DOES exercise the code path forces the
// "no url" throw *before* postgres() is ever called. The production DATABASE_URL
// is never read here — injection (a connectionString arg) keeps it out of reach.

function event(over: Partial<CallEvent> = {}): CallEvent {
  return {
    ts: new Date().toISOString(),
    endpoint: "answer",
    format: "json",
    category: "transcription",
    query: "events-pg-test-query",
    caller: "ip:test",
    userAgent: "vitest",
    ...over,
  };
}

describe("createPostgresStore — shape & lazy connection", () => {
  it("returns an EventStore with record() and since() and does not connect on construction", () => {
    // No connectionString + no getSql call = zero network. Just assert the shape.
    const store = createPostgresStore("postgres://never-connected.invalid/db");
    expect(typeof store.record).toBe("function");
    expect(typeof store.since).toBe("function");
  });

  it("record() rejects with a clear error when no url is configured (never connects)", async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    vi.resetModules();
    try {
      const { createPostgresStore: fresh } = await import("@/lib/events-pg");
      const store = fresh(); // no injected url, no env → must throw before postgres()
      await expect(store.record(event())).rejects.toThrow("DATABASE_URL is not set");
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original;
    }
  });
});

// Real round-trip against a THROWAWAY database only. Skipped whenever
// TEST_DATABASE_URL is absent (the default run + CI without a test DB), and it
// injects that url directly so the production DATABASE_URL is never used.
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "createPostgresStore — integration (TEST_DATABASE_URL only)",
  () => {
    it("records an event and reads it back via since()", async () => {
      vi.resetModules();
      const { createPostgresStore: fresh } = await import("@/lib/events-pg");
      const store = fresh(process.env.TEST_DATABASE_URL);
      const ev = event({ query: `it-${Date.now()}`, caller: `ip:${Date.now()}` });
      await store.record(ev);
      const rows = await store.since("2000-01-01");
      expect(rows.some((r) => r.query === ev.query && r.caller === ev.caller)).toBe(true);
    });
  },
);
