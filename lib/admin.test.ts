import { describe, it, expect, afterEach } from "vitest";
import {
  secretOk,
  adminPinOk,
  adminPinConfigured,
  adminPinLength,
  adminToken,
  adminAuthed,
  ADMIN_TOKEN_MAX_AGE_MS,
} from "@/lib/admin";

// The private /admin dashboard is locked by a shared secret. The login secret is
// METRICS_SECRET (or a numeric ADMIN_PIN when configured); the cookie is a
// signed, EXPIRING HMAC token signed with ADMIN_SECRET (falling back to
// METRICS_SECRET). The check is server-side; the secret never reaches client JS.
const originalMetrics = process.env.METRICS_SECRET;
const originalAdmin = process.env.ADMIN_SECRET;
const originalPin = process.env.ADMIN_PIN;
afterEach(() => {
  if (originalMetrics === undefined) delete process.env.METRICS_SECRET;
  else process.env.METRICS_SECRET = originalMetrics;
  if (originalAdmin === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = originalAdmin;
  if (originalPin === undefined) delete process.env.ADMIN_PIN;
  else process.env.ADMIN_PIN = originalPin;
});

describe("secretOk", () => {
  it("accepts the configured secret and rejects anything else", () => {
    process.env.METRICS_SECRET = "s3cr3t";
    expect(secretOk("s3cr3t")).toBe(true);
    expect(secretOk("wrong")).toBe(false);
    expect(secretOk("")).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    delete process.env.METRICS_SECRET;
    delete process.env.ADMIN_SECRET;
    expect(secretOk("s3cr3t")).toBe(false);
    expect(secretOk("")).toBe(false);
  });

  // Regression: compare must be constant-time and not throw on unequal lengths.
  it("does not throw on length-mismatched input", () => {
    process.env.METRICS_SECRET = "s3cr3t";
    expect(() => secretOk("x")).not.toThrow();
    expect(() => secretOk("a-much-longer-wrong-guess")).not.toThrow();
    expect(secretOk("x")).toBe(false);
  });
});

describe("adminPinOk (numeric PIN login)", () => {
  it("accepts the configured PIN and rejects anything else", () => {
    process.env.ADMIN_PIN = "246810";
    expect(adminPinOk("246810")).toBe(true);
    expect(adminPinOk("000000")).toBe(false);
    expect(adminPinOk("")).toBe(false);
    expect(adminPinOk("48355")).toBe(false); // one digit short
  });

  it("rejects everything when no PIN is configured", () => {
    delete process.env.ADMIN_PIN;
    expect(adminPinOk("246810")).toBe(false);
    expect(adminPinOk("")).toBe(false);
  });

  it("treats a blank/whitespace ADMIN_PIN as not configured", () => {
    process.env.ADMIN_PIN = "   ";
    expect(adminPinConfigured()).toBe(false);
    expect(adminPinOk("   ")).toBe(false);
  });

  it("does not throw on length-mismatched or odd input (constant-time compare)", () => {
    process.env.ADMIN_PIN = "246810";
    expect(() => adminPinOk("1")).not.toThrow();
    expect(() => adminPinOk("a-much-longer-wrong-guess")).not.toThrow();
    expect(adminPinOk("1")).toBe(false);
  });

  it("adminPinConfigured reflects whether ADMIN_PIN is set", () => {
    process.env.ADMIN_PIN = "246810";
    expect(adminPinConfigured()).toBe(true);
    delete process.env.ADMIN_PIN;
    expect(adminPinConfigured()).toBe(false);
  });

  it("adminPinLength reports the configured PIN length, null when unset", () => {
    process.env.ADMIN_PIN = "246810";
    expect(adminPinLength()).toBe(6);
    delete process.env.ADMIN_PIN;
    expect(adminPinLength()).toBeNull();
  });

  it("PIN login is independent of the secret (and vice versa)", () => {
    process.env.METRICS_SECRET = "s3cr3t";
    process.env.ADMIN_PIN = "246810";
    expect(adminPinOk("s3cr3t")).toBe(false); // secret is not a valid PIN
    expect(secretOk("246810")).toBe(false); // PIN is not a valid secret
  });
});

describe("cookie auth (signed, expiring token)", () => {
  it("authenticates a fresh signed token, not the raw secret", () => {
    process.env.METRICS_SECRET = "s3cr3t";
    const token = adminToken();
    expect(token).not.toBeNull();
    expect(token).not.toBe("s3cr3t"); // signed, not the secret itself
    expect(adminAuthed(token as string)).toBe(true);
    expect(adminAuthed("s3cr3t")).toBe(false); // raw secret is not a valid cookie
    expect(adminAuthed("anything-else")).toBe(false);
  });

  it("rejects a forged token (right shape, wrong signature)", () => {
    process.env.METRICS_SECRET = "s3cr3t";
    const forged = `${Date.now()}.deadbeef`;
    expect(adminAuthed(forged)).toBe(false);
  });

  it("rejects a token signed with a different key", () => {
    process.env.METRICS_SECRET = "s3cr3t";
    const token = adminToken() as string;
    // Now rotate the signing key: the old cookie must no longer authenticate.
    process.env.ADMIN_SECRET = "rotated-key";
    expect(adminAuthed(token)).toBe(false);
  });

  it("rejects an expired-but-genuine token (aged past the max age)", () => {
    process.env.METRICS_SECRET = "s3cr3t";
    const issuedAt = 1_000_000_000_000;
    const token = adminToken(issuedAt) as string;
    // Fresh at issue time, expired one ms past the window.
    expect(adminAuthed(token, issuedAt)).toBe(true);
    expect(adminAuthed(token, issuedAt + ADMIN_TOKEN_MAX_AGE_MS)).toBe(true);
    expect(adminAuthed(token, issuedAt + ADMIN_TOKEN_MAX_AGE_MS + 1)).toBe(false);
  });

  it("rejects a token with a future issuedAt or a non-numeric timestamp", () => {
    process.env.METRICS_SECRET = "s3cr3t";
    const now = 1_000_000_000_000;
    const future = adminToken(now + 10_000) as string;
    expect(adminAuthed(future, now)).toBe(false); // issued in the future
    expect(adminAuthed("notanumber.signature", now)).toBe(false);
    expect(adminAuthed(".justsig", now)).toBe(false);
  });

  it("prefers ADMIN_SECRET for signing, falling back to METRICS_SECRET", () => {
    // With only METRICS_SECRET, the token verifies.
    process.env.METRICS_SECRET = "metrics-key";
    delete process.env.ADMIN_SECRET;
    const t1 = adminToken() as string;
    expect(adminAuthed(t1)).toBe(true);

    // Set a dedicated ADMIN_SECRET: tokens are now signed with it, and a token
    // minted under the fallback key no longer verifies.
    process.env.ADMIN_SECRET = "dedicated-admin-key";
    const t2 = adminToken() as string;
    expect(adminAuthed(t2)).toBe(true);
    expect(adminAuthed(t1)).toBe(false);
  });

  it("authenticates nothing when no signing key is configured", () => {
    delete process.env.METRICS_SECRET;
    delete process.env.ADMIN_SECRET;
    expect(adminToken()).toBeNull();
    expect(adminAuthed("")).toBe(false);
    expect(adminAuthed("whatever")).toBe(false);
  });
});
