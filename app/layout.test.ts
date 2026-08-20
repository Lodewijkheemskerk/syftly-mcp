import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Guard for the Google Search Console verification token. GSC URL-prefix
// verification uses an HTML tag; Next renders metadata.verification.google as
// <meta name="google-site-verification" content="..."> in <head>. If this token
// is ever dropped, GSC silently loses verification — so pin it here.
const here = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(resolve(here, "layout.tsx"), "utf8");

describe("Google Search Console verification (AEO)", () => {
  it("declares the google-site-verification token in layout metadata", () => {
    expect(layout).toMatch(/verification:\s*\{\s*google:/);
    expect(layout).toContain("OYSv5A7S53z7LkknDy427rpjI2jjx2tKHsihIfJxOe8");
  });
});

// metadataBase makes every relative canonical/OG url absolute on the site
// origin; the OG/Twitter defaults give shared links a real preview instead of
// a bare URL. Both are string-pinned like the GSC token above.
describe("share/canonical metadata (AEO)", () => {
  it("declares metadataBase on the site origin", () => {
    expect(layout).toMatch(/metadataBase:\s*new URL\(siteUrl\(\)\)/);
  });

  it("declares openGraph and twitter defaults", () => {
    expect(layout).toMatch(/openGraph:/);
    expect(layout).toMatch(/siteName:\s*"Syftly"/);
    expect(layout).toMatch(/twitter:/);
  });
});

// Accessibility: a keyboard user must be able to skip the header nav and land on
// the main content, and the skip target must exist.
describe("skip-to-content (a11y)", () => {
  it("renders a skip link pointing at the main content landmark", () => {
    expect(layout).toContain('href="#main-content"');
    expect(layout).toContain('className="skip-link"');
    expect(layout).toContain('id="main-content"');
  });
});
