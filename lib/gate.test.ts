import { describe, it, expect, afterEach } from "vitest";
import { pinOk, sitePin, gateEnabled } from "@/lib/gate";

// The access gate is server-side (the PIN is verified here, never in client JS).
// L5: the gate is conditional on SITE_PIN. Unset/blank means the site is public —
// there is no 0303 default anymore, so an unconfigured production launches open,
// and you re-gate by setting SITE_PIN in the environment.

const original = process.env.SITE_PIN;
afterEach(() => {
  if (original === undefined) delete process.env.SITE_PIN;
  else process.env.SITE_PIN = original;
});

describe("gateEnabled / sitePin", () => {
  it("is off (public) when SITE_PIN is unset", () => {
    delete process.env.SITE_PIN;
    expect(gateEnabled()).toBe(false);
    expect(sitePin()).toBeNull();
  });

  it("is off (public) when SITE_PIN is blank/whitespace", () => {
    process.env.SITE_PIN = "   ";
    expect(gateEnabled()).toBe(false);
    expect(sitePin()).toBeNull();
  });

  it("is on with the configured PIN when SITE_PIN is set", () => {
    process.env.SITE_PIN = "1234";
    expect(gateEnabled()).toBe(true);
    expect(sitePin()).toBe("1234");
  });
});

describe("pinOk", () => {
  it("accepts the configured PIN (trimmed)", () => {
    process.env.SITE_PIN = "1234";
    expect(pinOk("1234")).toBe(true);
    expect(pinOk(" 1234 ")).toBe(true); // trimmed
  });

  it("rejects a wrong or empty code", () => {
    process.env.SITE_PIN = "1234";
    expect(pinOk("0000")).toBe(false);
    expect(pinOk("123")).toBe(false);
    expect(pinOk("")).toBe(false);
  });

  it("rejects everything when the gate is disabled (no PIN to match)", () => {
    delete process.env.SITE_PIN;
    expect(pinOk("1234")).toBe(false);
    expect(pinOk("")).toBe(false);
  });

  // Regression: the compare must be constant-time (crypto.timingSafeEqual). We
  // can't assert timing directly in a unit test, but we can assert it never
  // throws on unequal-length input (timingSafeEqual throws on mismatched
  // buffers) and still returns the correct boolean.
  it("compares in constant time without throwing on unequal lengths", () => {
    process.env.SITE_PIN = "1234";
    expect(() => pinOk("1")).not.toThrow();
    expect(() => pinOk("a much longer wrong guess")).not.toThrow();
    expect(pinOk("1")).toBe(false);
    expect(pinOk("12345")).toBe(false);
    expect(pinOk("1234")).toBe(true);
  });
});
