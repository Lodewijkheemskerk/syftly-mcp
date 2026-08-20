import type { MetadataRoute } from "next";
import { canonical } from "@/lib/site";

// Invite every crawler in (agents/crawlers are the moat) and point at the
// sitemap. Crawl broadly; only the non-content paths are off-limits: the
// protected north-star metrics, the PIN gate screen and the private dashboard.
// The engine long-tail is intentionally NOT disallowed — it carries a per-page
// noindex meta, so it must stay crawlable for that meta to be read (ADR 0009).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/internal/", "/unlock", "/admin"],
    },
    sitemap: canonical("/sitemap.xml"),
  };
}
