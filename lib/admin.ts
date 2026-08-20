import { createHmac, timingSafeEqual } from "node:crypto";

// Lock for the private /admin dashboard. Server-side only: the secret is
// verified here, never shipped to the client.
//
// The signing key is ADMIN_SECRET, falling back to METRICS_SECRET when unset so
// existing deploys (which only have METRICS_SECRET) keep working. Prefer setting
// a dedicated ADMIN_SECRET so the admin cookie and the metrics endpoint don't
// share one key.
//
// RATE LIMITING: the login POST is brute-forceable; the required mitigation is a
// Vercel WAF rate-limit rule on POST /api/admin/login — see docs/SECURITY.md.

/** Cookie the /admin route looks for; set httpOnly by the login route. */
export const ADMIN_COOKIE = "syftly_admin";

/** How long an issued admin cookie stays valid. After this the token is
 * rejected by adminAuthed() even if the signature is intact, so cookies age out
 * (the old design was a permanent, non-expiring skeleton key). */
export const ADMIN_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** The configured admin login secret, or null when none is set. This is the
 * value a user types at the login screen. */
function adminSecret(): string | null {
  const s = process.env.METRICS_SECRET?.trim();
  return s && s.length > 0 ? s : null;
}

/** The HMAC signing key for the admin cookie. Prefers a dedicated ADMIN_SECRET,
 * falls back to METRICS_SECRET so existing deploys don't break. Null when
 * neither is set. */
function signingKey(): string | null {
  const admin = process.env.ADMIN_SECRET?.trim();
  if (admin && admin.length > 0) return admin;
  return adminSecret();
}

/** Constant-time string compare, guarded for length (timingSafeEqual throws on
 * unequal-length buffers; an early length-mismatch return is itself a timing
 * side-channel, so lengths are only compared once both are buffers). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** True iff a secret is configured and the typed login input matches it. */
export function secretOk(input: string): boolean {
  const secret = adminSecret();
  return secret !== null && typeof input === "string" && safeEqual(input, secret);
}

/** The configured numeric admin PIN (env ADMIN_PIN), or null when unset/blank.
 * A PIN is a convenience login for the dashboard keypad — deliberately weaker
 * than the secret (10^6 guesses for 6 digits), so the login route pairs it with
 * a failed-attempt delay and the WAF rate-limit rule (docs/SECURITY.md). */
function adminPin(): string | null {
  const p = process.env.ADMIN_PIN?.trim();
  return p && p.length > 0 ? p : null;
}

/** True iff an ADMIN_PIN is configured — drives whether the login screen shows
 * the keypad (PIN mode) or the secret input (fallback). */
export function adminPinConfigured(): boolean {
  return adminPin() !== null;
}

/** Length of the configured PIN (for the keypad dots/auto-submit), or null when
 * no PIN is set. Exposing the length to the login screen is the iPhone
 * trade-off: slightly smaller guess space, much better UX. */
export function adminPinLength(): number | null {
  return adminPin()?.length ?? null;
}

/** True iff a PIN is configured and the typed login input matches it
 * (constant-time). The PIN and the secret are separate credentials: a PIN never
 * validates as a secret and vice versa. */
export function adminPinOk(input: string): boolean {
  const pin = adminPin();
  return pin !== null && typeof input === "string" && safeEqual(input, pin);
}

/** HMAC-SHA256 of a payload under the signing key, hex-encoded. */
function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

/** Issue a signed, EXPIRING admin cookie token: "<issuedAt>.<hmac>", where the
 * HMAC is taken over the issuedAt timestamp with the server signing key. The
 * timestamp lets adminAuthed() expire old cookies; the HMAC makes the token
 * unforgeable without the key (it is no longer a constant or a reversible hash
 * of the secret). Null when no signing key is configured.
 *
 * `now` is injectable for testing. */
export function adminToken(now: number = Date.now()): string | null {
  const key = signingKey();
  if (key === null) return null;
  const issuedAt = String(now);
  return `${issuedAt}.${sign(issuedAt, key)}`;
}

/** True iff the cookie carries a token with (a) a valid HMAC under the current
 * signing key and (b) an issuedAt within ADMIN_TOKEN_MAX_AGE_MS of now. Both the
 * signature check and the freshness check must pass, so forged tokens AND
 * expired-but-genuine tokens are rejected.
 *
 * `now` is injectable for testing. */
export function adminAuthed(
  cookieValue: string | undefined | null,
  now: number = Date.now(),
): boolean {
  const key = signingKey();
  if (key === null || typeof cookieValue !== "string") return false;

  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return false;
  const issuedAt = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);

  // Verify the signature in constant time over the exact issuedAt we read back.
  const expected = sign(issuedAt, key);
  if (!safeEqual(signature, expected)) return false;

  // Freshness: reject tokens older than the max age (or with a bogus/future ts).
  const issuedMs = Number(issuedAt);
  if (!Number.isFinite(issuedMs)) return false;
  const age = now - issuedMs;
  return age >= 0 && age <= ADMIN_TOKEN_MAX_AGE_MS;
}
