import { createMemoryStore, type EventStore } from "@/lib/events";
import { createPostgresStore } from "@/lib/events-pg";

// Pick the telemetry store once. Postgres when DATABASE_URL is configured
// (production), else an in-memory store so builds, tests and local dev without a
// database don't crash — they simply don't persist. This is the seam that keeps
// the rest of the app (telemetry, metrics) ignorant of where events live.
let store: EventStore | null = null;

export function getEventStore(): EventStore {
  if (!store) {
    store = process.env.DATABASE_URL ? createPostgresStore() : createMemoryStore();
  }
  return store;
}
