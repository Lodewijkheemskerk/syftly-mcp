import { describe, it, expect } from "vitest";
import robots from "@/app/robots";
import { canonical } from "@/lib/site";

// robots.txt invites crawlers in (the agents/crawlers are the moat — AEO) and
// points them at the sitemap. It deliberately does NOT disallow the engine
// long-tail: those pages carry a noindex meta, so they must stay crawlable or
// Google can't read the noindex (ADR 0009). See the disallow test below.
const result = robots();

function rules() {
  return Array.isArray(result.rules) ? result.rules : [result.rules];
}

describe("robots", () => {
  it("staat crawlen breed toe voor elke user-agent", () => {
    const wildcard = rules().find((r) => r.userAgent === "*");
    expect(wildcard).toBeDefined();
    expect(wildcard!.allow).toBe("/");
  });

  it("verwijst naar de sitemap op de site-origin", () => {
    expect(result.sitemap).toBe(canonical("/sitemap.xml"));
  });

  it("weert niet-inhoud paden (beveiligde metrics + gate) maar NIET de long-tail", () => {
    const disallow = rules().flatMap((r) =>
      Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
    );
    expect(disallow).toContain("/api/internal/"); // protected north-star metrics
    expect(disallow).toContain("/unlock"); // the PIN gate screen, no content
    expect(disallow).toContain("/admin"); // private metrics dashboard, no content
    // Crucial AEO point (ADR 0009): the category answer paths must stay
    // crawlable so Google can read the per-page noindex meta on the long-tail.
    // Blocking them in robots would hide that meta and risk bare indexing.
    expect(disallow).not.toContain("/transcription/");
    expect(disallow).not.toContain("/");
  });
});
