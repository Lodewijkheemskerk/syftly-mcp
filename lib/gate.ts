import { timingSafeEqual } from "node:crypto";

// Soft access gate (a shareable numeric PIN, iPhone-unlock style) for keeping
// the unfinished platform private. NOT real security: a 4-digit code is ~10k
// guesses. The check runs server-side (the proxy + route), so the PIN never
// ships in the client bundle; the gate cookie is httpOnly. For real privacy use
// Vercel Authentication instead.
//
// L5 (public launch): the gate is conditional on SITE_PIN. Unset/blank => the
// gate is OFF and the whole site is public. Set SITE_PIN to re-gate (no code
// change, no redeploy of code — just an env var). There is deliberately NO
// default PIN: an unconfigured production launches open, not silently locked.
//
// RATE LIMITING: a 4-digit PIN is online-brute-forceable (~10k guesses). We do
// NOT add a rate-limit dependency here; the required mitigation is a Vercel WAF
// rate-limit rule on POST /api/unlock — see docs/SECURITY.md.

/** Cookie the proxy looks for; set httpOnly by the unlock route. */
export const GATE_COOKIE = "syftly_access";

/** Opaque token stored in the cookie after a correct PIN. Server-only — it is
 * never sent to the client except as an unreadable httpOnly cookie value, so it
 * cannot be forged from client JS.
 *
 * KNOWN WEAKNESS (documented, accepted for the soft gate): this is a hard-coded
 * constant, not a signed/expiring token. Anyone who learns the value (e.g. via a
 * future XSS or a leaked cookie) can mint a permanent gate cookie, and it cannot
 * be rotated without a code change. This is acceptable because the gate is an
 * obscurity speed-bump, not a security boundary — real privacy is Vercel
 * Authentication. The admin token (lib/admin.ts) IS signed+expiring because it
 * guards the metrics dashboard. */
export const GATE_TOKEN = "syftly-unlocked-v1";

/** Constant-time string compare, guarded for length (timingSafeEqual throws on
 * unequal-length buffers, and an early length-mismatch return would itself be a
 * timing side-channel — so we compare lengths only after both are buffers). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** The configured PIN, or null when none is set. SITE_PIN unset/blank means the
 * gate is disabled (the site is public). */
export function sitePin(): string | null {
  const fromEnv = process.env.SITE_PIN?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

/** Whether the PIN gate is active. Off (public) when no SITE_PIN is configured. */
export function gateEnabled(): boolean {
  return sitePin() !== null;
}

/** PIN check. Trims input; compares to the configured PIN in constant time.
 * Always false when the gate is disabled (there is no PIN to match). */
export function pinOk(input: string): boolean {
  const pin = sitePin();
  if (pin === null || typeof input !== "string") return false;
  return safeEqual(input.trim(), pin);
}
