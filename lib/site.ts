// The site origin, env-driven. Default = the launch host so the app needs zero
// config; swapping to a custom domain later is one env var (RESUME L3, ADR-Q6
// domain decision). Read at call time (not module load) so it stays testable.
const DEFAULT_SITE_URL = "https://syftly.vercel.app";

export function siteUrl(): string {
  const raw = process.env.SITE_URL?.trim() || DEFAULT_SITE_URL;
  return raw.replace(/\/+$/, "");
}

/** Absolute URL for an internal path on the site origin. Home ("/") has no
 * trailing slash; any other path is joined with exactly one leading slash. */
export function canonical(path: string): string {
  if (path === "/" || path === "") return siteUrl();
  return siteUrl() + "/" + path.replace(/^\/+/, "");
}
