import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, GATE_TOKEN, gateEnabled } from "@/lib/gate";

// Soft access gate (Next 16 "proxy" convention, formerly middleware): every
// route is behind the PIN except the unlock screen and its verify endpoint. No
// valid gate cookie -> redirect to /unlock, carrying the originally-requested
// path so we can return there after unlocking. Static assets are excluded by the
// matcher so the lock screen can style itself.
//
// L5: the gate is conditional. With no SITE_PIN configured the gate is OFF and
// the site is public; setting SITE_PIN re-gates everything without a code change.
export function proxy(request: NextRequest) {
  // Gate disabled (no SITE_PIN) -> the whole site is public.
  if (!gateEnabled()) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;

  if (pathname === "/unlock" || pathname === "/api/unlock") {
    return NextResponse.next();
  }

  if (request.cookies.get(GATE_COOKIE)?.value === GATE_TOKEN) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next's static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
