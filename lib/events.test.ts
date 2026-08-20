import { describe, it, expect } from "vitest";
import { createMemoryStore, type CallEvent } from "@/lib/events";

function ev(over: Partial<CallEvent> = {}): CallEvent {
  return {
    ts: "2026-06-22T10:00:00.000Z",
    endpoint: "answer",
    format: "json",
    category: "transcription",
    query: "best transcription api",
    caller: "ip:abc",
    userAgent: "curl",
    ...over,
  };
}

describe("createMemoryStore", () => {
  it("bewaart een opgenomen event", async () => {
    const store = createMemoryStore();
    await store.record(ev());
    const all = await store.since("2026-06-01T00:00:00.000Z");
    expect(all).toHaveLength(1);
  });

  it("since filtert events vóór de grens weg", async () => {
    const store = createMemoryStore();
    await store.record(ev({ ts: "2026-05-01T00:00:00.000Z" }));
    await store.record(ev({ ts: "2026-06-10T00:00:00.000Z" }));
    const recent = await store.since("2026-06-01T00:00:00.000Z");
    expect(recent).toHaveLength(1);
    expect(recent[0].ts).toBe("2026-06-10T00:00:00.000Z");
  });
});
