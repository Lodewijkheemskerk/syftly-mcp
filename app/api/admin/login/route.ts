import { ADMIN_COOKIE, adminToken, adminPinOk, secretOk } from "@/lib/admin";

// Verify the admin credential server-side and, on success, set the httpOnly
// cookie the /admin page checks. Two credentials are accepted, each in its own
// field: a numeric PIN (env ADMIN_PIN, used by the keypad login) or the shared
// secret (METRICS_SECRET, the original text login — kept as fallback so an
// unset ADMIN_PIN never locks the dashboard). The cookie carries a signed,
// EXPIRING token (HMAC over an issuedAt timestamp), never the credential itself.
// Set via a Set-Cookie header (not next/headers) so the handler stays a pure,
// testable function. Secure only in production so http://localhost keeps working.
//
// RATE LIMITING: a 6-digit PIN is online-brute-forceable (~10^6 guesses). WAF
// rate limiting is unavailable on the Hobby plan (decision 6 jul, see
// docs/SECURITY.md), so this in-process delay on FAILED attempts is the primary
// speed-bump: 1.5s per wrong guess makes a sequential sweep take weeks, while a
// legitimate user who types the right PIN is never slowed.
const FAILED_ATTEMPT_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 1500;

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const pin = typeof body?.pin === "string" ? body.pin : "";
  const secret = typeof body?.secret === "string" ? body.secret : "";

  const ok = (pin !== "" && adminPinOk(pin)) || (secret !== "" && secretOk(secret));
  if (!ok) {
    await delay(FAILED_ATTEMPT_DELAY_MS);
    return Response.json({ ok: false }, { status: 401 });
  }

  const maxAge = 60 * 60 * 24 * 30; // 30 days
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `${ADMIN_COOKIE}=${adminToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": cookie },
  });
}
