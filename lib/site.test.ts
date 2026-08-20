import { describe, it, expect, afterEach } from "vitest";
import { siteUrl, canonical } from "@/lib/site";

// SITE_URL is the single, env-driven origin for every absolute URL we emit
// (sitemap, robots). It defaults to the launch host so the app works with zero
// config; pointing at a custom domain later is a one-line env change (RESUME L3).
describe("siteUrl", () => {
  afterEach(() => {
    delete process.env.SITE_URL;
  });

  it("valt terug op de productie-default zonder env", () => {
    delete process.env.SITE_URL;
    expect(siteUrl()).toBe("https://syftly.vercel.app");
  });

  it("laat SITE_URL de default overrulen", () => {
    process.env.SITE_URL = "https://syftly.com";
    expect(siteUrl()).toBe("https://syftly.com");
  });

  it("normaliseert een trailing slash weg zodat aaneengeplakte paden kloppen", () => {
    process.env.SITE_URL = "https://syftly.com/";
    expect(siteUrl()).toBe("https://syftly.com");
  });

  it("negeert een lege/whitespace SITE_URL en pakt de default", () => {
    process.env.SITE_URL = "   ";
    expect(siteUrl()).toBe("https://syftly.vercel.app");
  });
});

// canonical() turns an internal path into an absolute URL on the site origin —
// the single place that knows how to join origin + path (no double slash, the
// home route has no trailing slash). Sitemap/robots build every URL through it.
describe("canonical", () => {
  afterEach(() => {
    delete process.env.SITE_URL;
  });

  it("geeft de kale origin terug voor de homepage", () => {
    expect(canonical("/")).toBe("https://syftly.vercel.app");
  });

  it("plakt een sub-pad zonder dubbele slash aan de origin", () => {
    expect(canonical("/categories")).toBe("https://syftly.vercel.app/categories");
  });

  it("normaliseert een pad zonder leading slash", () => {
    expect(canonical("methodology")).toBe("https://syftly.vercel.app/methodology");
  });

  it("bouwt op dezelfde env-gedreven origin als siteUrl", () => {
    process.env.SITE_URL = "https://syftly.com";
    expect(canonical("/for-agents")).toBe("https://syftly.com/for-agents");
  });
});
