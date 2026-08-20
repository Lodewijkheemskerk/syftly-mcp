import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { canonical } from "@/lib/site";
import { listCategories } from "@/lib/categories";

// Guard for the MCP Registry manifest (server.json). A wrong manifest = a broken
// public registry listing, so we pin it the same way the quality gates pin the
// category rankings (ADR 0007: automated gates, not human review). This keeps the
// published listing honest and consistent with the live endpoint.
const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, "server.json"), "utf8")) as Record<
  string,
  unknown
>;

describe("server.json (MCP Registry manifest)", () => {
  it("declares the official server.schema.json", () => {
    expect(manifest.$schema).toBe(
      "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    );
  });

  it("has the required registry fields, with a concise description", () => {
    expect(typeof manifest.name).toBe("string");
    expect(typeof manifest.description).toBe("string");
    const description = manifest.description as string;
    expect(description.length).toBeGreaterThan(0);
    // Registry descriptions are short blurbs; keep it tight (the schema caps this).
    expect(description.length).toBeLessThanOrEqual(100);
    expect(typeof manifest.version).toBe("string");
  });

  it("uses the GitHub-namespaced name matching the publish identity", () => {
    // GitHub-based publishing requires the name to start with io.github.<username>/
    // (mcp-publisher login github). Pin the namespace so the manifest can only be
    // published under our identity.
    expect(manifest.name).toMatch(/^io\.github\.Lodewijkheemskerk\/[a-z0-9-]+$/);
  });

  it("declares exactly one streamable-http remote", () => {
    expect(Array.isArray(manifest.remotes)).toBe(true);
    const remotes = manifest.remotes as Array<{ type: string; url: string }>;
    expect(remotes).toHaveLength(1);
    expect(remotes[0].type).toBe("streamable-http");
  });

  it("points the remote at the canonical live MCP endpoint", () => {
    // Drift guard: if SITE_URL swaps to a custom domain, this goes red until
    // server.json is updated and re-published to the registry.
    const remotes = manifest.remotes as Array<{ type: string; url: string }>;
    expect(remotes[0].url).toBe(canonical("/api/mcp"));
  });

  it("uses a valid semver version", () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("omits a repository link while the GitHub repo is private", () => {
    // Intentional: a 404 link in a public registry looks broken. Re-add when public.
    expect(manifest.repository).toBeUndefined();
  });

  it("mentions every registered category in the description (FIX 6 drift-guard)", () => {
    // The description hard-codes the category list, which can drift from the
    // registry. We can't fit the FULL labels (e.g. "OCR & document extraction")
    // and stay under the 100-char cap, so we assert each label's DISTINCTIVE head
    // token appears (e.g. "ocr", "scraping"). Registering a new category in
    // lib/categories.ts that the blurb doesn't mention turns this red.
    const description = (manifest.description as string).toLowerCase();
    for (const r of listCategories()) {
      const head = r.label.toLowerCase().split(/[ &]/)[0]; // first word, e.g. "web", "ocr"
      expect(description).toContain(head);
    }
  });
});
