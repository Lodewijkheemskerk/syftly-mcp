import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { size, contentType, alt } from "@/app/opengraph-image";

// Share/branding hygiene: a favicon so the tab isn't blank, and an Open Graph
// image so a shared Syftly link renders a real preview card. Both are Next file
// conventions (app/icon.svg, app/opengraph-image.tsx) — no <link> tags to wire.

describe("Branding assets", () => {
  it("ships an SVG favicon at app/icon.svg", () => {
    const path = join(process.cwd(), "app", "icon.svg");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("<svg");
  });

  it("ships an Open Graph image at the standard share-card size", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt.toLowerCase()).toContain("syftly");
  });
});
