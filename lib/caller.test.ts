import { describe, it, expect, afterEach } from "vitest";
import { callerId, callerFromRequest, isSelfCaller } from "@/lib/caller";

// Hybrid caller identity for the north-star (Q6): an explicit API key wins, else
// a hashed *IP-only* fingerprint. Zero forced friction (ADR-Q6) while still
// giving a per-caller signal. The user-agent is deliberately excluded from the
// identity — it is spoofable entropy, not signal.
describe("callerId — hybride identiteit (Q6)", () => {
  it("een API-key wint van de vingerafdruk", () => {
    const id = callerId({ apiKey: "abc123", ip: "1.2.3.4", userAgent: "curl" });
    expect(id).toBe("key:abc123");
  });

  it("zonder key: hetzelfde ip geeft dezelfde id", () => {
    const a = callerId({ ip: "1.2.3.4", userAgent: "curl/8" });
    const b = callerId({ ip: "1.2.3.4", userAgent: "curl/8" });
    expect(a).toBe(b);
    expect(a.startsWith("ip:")).toBe(true);
  });

  it("negeert de user-agent in de identiteit (spoofbaar): zelfde ip = zelfde id", () => {
    const a = callerId({ ip: "1.2.3.4", userAgent: "curl/8" });
    const b = callerId({ ip: "1.2.3.4", userAgent: "python-requests" });
    expect(a).toBe(b);
  });

  it("een ander ip geeft een andere id", () => {
    const a = callerId({ ip: "1.2.3.4", userAgent: "x" });
    const b = callerId({ ip: "5.6.7.8", userAgent: "x" });
    expect(a).not.toBe(b);
  });

  it("houdt de 16-hex-char sha256-truncatie aan", () => {
    const id = callerId({ ip: "1.2.3.4" });
    expect(id).toMatch(/^ip:[0-9a-f]{16}$/);
  });

  it("slaat het rauwe IP niet op in de id (privacy)", () => {
    const id = callerId({ ip: "203.0.113.7", userAgent: "x" });
    expect(id).not.toContain("203.0.113.7");
  });

  it("een lege key valt terug op de vingerafdruk", () => {
    const id = callerId({ apiKey: "  ", ip: "1.2.3.4", userAgent: "x" });
    expect(id.startsWith("ip:")).toBe(true);
  });

  it("blijft deterministisch zonder ip en ua", () => {
    expect(callerId({})).toBe(callerId({}));
  });
});

// Self-tagging: when the caller presents the SELF_CALLER_KEY, their identity
// becomes "self:you" so the dashboard can separate the owner's test traffic
// from strangers — the whole point of the north-star is *strangers* coming back.
describe("self-tagging (SELF_CALLER_KEY)", () => {
  const original = process.env.SELF_CALLER_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.SELF_CALLER_KEY;
    else process.env.SELF_CALLER_KEY = original;
  });

  it("de self-key wordt self:you, niet key:<k>", () => {
    process.env.SELF_CALLER_KEY = "my-self-key";
    expect(callerId({ apiKey: "my-self-key", ip: "1.2.3.4" })).toBe("self:you");
  });

  it("andere keys blijven gewoon key:<k>", () => {
    process.env.SELF_CALLER_KEY = "my-self-key";
    expect(callerId({ apiKey: "someone-else", ip: "1.2.3.4" })).toBe("key:someone-else");
  });

  it("zonder geconfigureerde self-key is niets self", () => {
    delete process.env.SELF_CALLER_KEY;
    expect(callerId({ apiKey: "my-self-key" })).toBe("key:my-self-key");
  });

  it("isSelfCaller herkent alleen de self:-prefix", () => {
    expect(isSelfCaller("self:you")).toBe(true);
    expect(isSelfCaller("key:abc")).toBe(false);
    expect(isSelfCaller("ip:deadbeef")).toBe(false);
  });
});

describe("callerFromRequest", () => {
  it("leest de key uit de x-api-key header", () => {
    const req = new Request("https://x/api/answer?query=foo", {
      headers: { "x-api-key": "k1", "user-agent": "ua" },
    });
    expect(callerFromRequest(req).apiKey).toBe("k1");
  });

  it("valt terug op de ?key= query-parameter", () => {
    const req = new Request("https://x/api/answer?query=foo&key=k2");
    expect(callerFromRequest(req).apiKey).toBe("k2");
  });

  it("neemt het eerste IP uit x-forwarded-for als laatste redmiddel", () => {
    const req = new Request("https://x/", {
      headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
    });
    expect(callerFromRequest(req).ip).toBe("9.9.9.9");
  });

  it("verkiest het vertrouwde x-vercel-forwarded-for boven x-forwarded-for", () => {
    // x-forwarded-for is door de client te zetten; het Vercel-header niet.
    const req = new Request("https://x/", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.5, 70.0.0.1",
        "x-real-ip": "8.8.8.8",
        "x-forwarded-for": "1.1.1.1",
      },
    });
    expect(callerFromRequest(req).ip).toBe("203.0.113.5");
  });

  it("valt terug op x-real-ip wanneer het Vercel-header ontbreekt", () => {
    const req = new Request("https://x/", {
      headers: { "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1" },
    });
    expect(callerFromRequest(req).ip).toBe("8.8.8.8");
  });

  it("blijft de user-agent voor telemetrie meelezen (los van de identiteit)", () => {
    const req = new Request("https://x/", { headers: { "user-agent": "curl/8" } });
    expect(callerFromRequest(req).userAgent).toBe("curl/8");
  });
});
