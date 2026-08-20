import { timingSafeEqual } from "node:crypto";
import { getEventStore } from "@/lib/event-store";
import { northStar, usageEvents } from "@/lib/metrics";

// Constant-time compare guarded for length (timingSafeEqual throws on
// unequal-length buffers); both inputs are bytes before lengths are compared.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Internal read of the north-star metric (Q6: how many distinct callers came
// back >= 2x). Protected by a shared secret so it stays private once the PIN
// gate is removed. Set METRICS_SECRET in env; call with header `x-metrics-secret`
// or `?secret=`. `?days=` sets the window (default 30).
//
// RATE LIMITING: the secret is brute-forceable; the required mitigation is a
// Vercel WAF rate-limit rule on /api/internal/metrics — see docs/SECURITY.md.
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.METRICS_SECRET;
  const url = new URL(request.url);
  const provided = request.headers.get("x-metrics-secret") ?? url.searchParams.get("secret");
  if (!secret || provided === null || !safeEqual(provided, secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const requested = Number(url.searchParams.get("days") ?? "30");
  const windowDays = Number.isFinite(requested) && requested > 0 ? requested : 30;
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const events = await getEventStore().since(since);

  // The north-star counts strangers' questions only: self-tagged test traffic
  // and initialize handshakes are excluded (same filter as the dashboard).
  return Response.json({ window_days: windowDays, since, ...northStar(usageEvents(events)) });
}
