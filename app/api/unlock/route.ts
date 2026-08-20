import { GATE_COOKIE, GATE_TOKEN, pinOk } from "@/lib/gate";

// Verify the access PIN server-side and, on success, set the httpOnly gate
// cookie the middleware checks. The cookie is set via a Set-Cookie header (not
// next/headers) so the handler stays a pure, testable function. Secure only in
// production so the flow still works over http://localhost in dev.
//
// RATE LIMITING (Finding 1): a 4-digit PIN is online-brute-forceable (~10k
// guesses). We cannot add a rate-limit dependency and serverless in-memory state
// is unreliable across instances, so the REQUIRED mitigation is a Vercel WAF
// rate-limit rule on POST /api/unlock — see docs/SECURITY.md. As a best-effort
// in-process speed-bump (no dep, works per-instance) we add a small fixed delay
// on FAILED attempts only: legitimate users succeed on the first try and are not
// slowed, while a brute-force sweep of the ~10k space pays the delay per guess.
// This is a soft deterrent, not a substitute for the WAF rule.
// 1.5s (was 400ms): WAF rate limiting is unavailable on the Hobby plan
// (decision 6 jul, docs/SECURITY.md), so this delay is the primary speed-bump.
const FAILED_ATTEMPT_DELAY_MS =
  process.env.NODE_ENV === "test" ? 0 : 1500;

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({ code: "" }));
  const code = typeof body?.code === "string" ? body.code : "";

  if (!pinOk(code)) {
    await delay(FAILED_ATTEMPT_DELAY_MS);
    return Response.json({ ok: false }, { status: 401 });
  }

  const maxAge = 60 * 60 * 24 * 30; // 30 days
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `${GATE_COOKIE}=${GATE_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": cookie },
  });
}
