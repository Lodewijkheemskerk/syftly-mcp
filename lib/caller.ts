import { createHash } from "node:crypto";

// Caller identity for the north-star metric (Q6: count unique callers that hit
// the endpoints >= 2x). Hybrid identity with no forced friction (ADR-Q6): an
// explicit API key wins; otherwise a coarse, *hashed* fingerprint of the trusted
// client IP so a raw IP is never persisted. The key is only an identity tag —
// there is no paywall in MVP-1 (the endpoint stays free).
//
// SECURITY: the ip-hash is a best-effort *soft lower bound* on distinct callers,
// NOT an anti-spoof identity. A caller behind a shared NAT collapses to one id,
// and a caller rotating IPs (or forging the proxy header on an unprotected
// deploy) inflates the count. We deliberately DROP the user-agent: it is trivial
// to spoof and adds spoofable entropy, not real signal — so the only thing
// folded into the hash is the IP we (best-effort) trust from Vercel's edge.
export interface CallerInput {
  apiKey?: string | null;
  ip?: string | null;
  // Recorded for telemetry/debugging only; intentionally NOT part of callerId.
  userAgent?: string | null;
}

export function callerId(input: CallerInput): string {
  const key = input.apiKey?.trim();
  if (key) {
    // Self-tagging: the owner's own test traffic identifies itself with
    // SELF_CALLER_KEY (sent as x-api-key) and collapses to one stable "self"
    // identity, IP-independent. The dashboard labels it and the north-star
    // excludes it — the metric is about STRANGERS coming back, not about us.
    const self = process.env.SELF_CALLER_KEY?.trim();
    if (self && key === self) return "self:you";
    return `key:${key}`;
  }
  // Identity = trusted IP only. user-agent is excluded on purpose (spoofable).
  const fingerprint = `${input.ip ?? ""}`;
  const hash = createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
  return `ip:${hash}`;
}

/** True iff this caller id is the owner's self-tagged test traffic. Pure string
 * check so metric code can use it without touching the environment. */
export function isSelfCaller(caller: string): boolean {
  return caller.startsWith("self:");
}

// Pull the identity signals off a real request. Header `x-api-key` or the
// `?key=` query param carry the optional key.
//
// For the client IP we prefer Vercel's *trusted* client IP header
// (`x-vercel-forwarded-for`, which the platform sets and a client cannot
// override), then `x-real-ip`, and only as a last resort the first hop of the
// raw, client-controllable `x-forwarded-for`. This raises (but does not
// eliminate) the bar for forging an identity — see the SECURITY note above.
export function callerFromRequest(req: Request): CallerInput {
  const url = new URL(req.url);
  const apiKey = req.headers.get("x-api-key") ?? url.searchParams.get("key");
  const ip = clientIp(req);
  return { apiKey, ip, userAgent: req.headers.get("user-agent") };
}

// Resolve the most-trustworthy available client IP. The order matters: the
// Vercel-injected headers cannot be set by the client, while x-forwarded-for can
// be, so it is only the final fallback (and only its first hop).
function clientIp(req: Request): string | null {
  const vercel = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}
