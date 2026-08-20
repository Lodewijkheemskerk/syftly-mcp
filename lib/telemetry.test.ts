import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Telemetry is fire-and-forget: it must NEVER throw into the request path, and it
// must NEVER silently lose the north-star metric without a trace. These tests pin
// both halves of that contract — the swallow AND the log — with next/server's
// after(), the event store and the caller-parser all mocked so nothing touches a
// real request scope or database.
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/event-store", () => ({ getEventStore: vi.fn() }));
vi.mock("@/lib/caller", () => ({ callerFromRequest: vi.fn(), callerId: vi.fn() }));

import { after } from "next/server";
import { getEventStore } from "@/lib/event-store";
import { callerFromRequest, callerId } from "@/lib/caller";
import { recordCall } from "@/lib/telemetry";

const req = new Request("https://syftly.test/api/answer");
const fields = { endpoint: "answer", format: "json", category: "transcription", query: "q" };

let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(callerFromRequest).mockReturnValue({ apiKey: null, ip: "1.2.3.4", userAgent: "ua" });
  vi.mocked(callerId).mockReturnValue("ip:abc");
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  errSpy.mockRestore();
});

describe("recordCall — fire-and-forget contract", () => {
  it("does not throw when the store fails, and logs the swallowed error", async () => {
    // after() runs the scheduled callback (as it would in a live request); the
    // store rejects. We capture the callback's promise so we can await the
    // internal catch before asserting.
    let scheduled: Promise<unknown> | undefined;
    vi.mocked(after).mockImplementation((fn) => {
      scheduled = (fn as () => Promise<unknown>)();
    });
    vi.mocked(getEventStore).mockReturnValue({
      record: vi.fn().mockRejectedValue(new Error("db down")),
      since: vi.fn(),
    });

    expect(() => recordCall(req, fields)).not.toThrow();
    await scheduled;

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[syftly:telemetry] store.record failed"),
      expect.any(Error),
    );
  });

  it("stays silent (no throw, no error log) when after() is unavailable (out of request scope)", () => {
    // Outside a request scope after() throws synchronously — expected control
    // flow, not a failure, so it must not be logged as an error.
    vi.mocked(after).mockImplementation(() => {
      throw new Error("after() called outside a request scope");
    });

    expect(() => recordCall(req, fields)).not.toThrow();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("does not throw and logs when building the event fails, and never schedules a write", () => {
    vi.mocked(callerFromRequest).mockImplementation(() => {
      throw new Error("malformed request");
    });

    expect(() => recordCall(req, fields)).not.toThrow();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[syftly:telemetry] failed to build call event"),
      expect.any(Error),
    );
    expect(after).not.toHaveBeenCalled();
  });
});
