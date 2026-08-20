import { describe, it, expect } from "vitest";
import { getRanking, projectArtefact, listPublishedSlugs } from "@/lib/ranking";

const SLUG = "best-transcription-api-for-dutch";

// The Categorie-ranking is the knowledge atom; an Antwoord-artefact is a view
// projected from it for one published query (ADR 0002/0005). This replaces the
// pre-baked Record<slug, artefact> seed, which contradicted ADR 0005's chosen
// option B (query-engine over the ranking, not a fixed inventory of pages).
describe("Categorie-ranking → projectie", () => {
  it("draagt een geordende provider-lijst en gedeelde bronnen", () => {
    const ranking = getRanking();
    expect(ranking.category).toBe("transcription");
    expect(ranking.providers.length).toBeGreaterThan(1);
    expect(ranking.bronnen.length).toBeGreaterThan(0);
  });

  it("projecteert de gepubliceerde query naar een volledig artefact", () => {
    const ranking = getRanking();
    const artefact = projectArtefact(ranking, SLUG)!;
    expect(artefact.slug).toBe(SLUG);
    expect(artefact.query).toBe("Best transcription API for Dutch");
    expect(artefact.category).toBe("transcription");
    expect(artefact.zekerheidslabel).toBe("light estimate");
    // shared, straight from the ranking
    expect(artefact.providers).toEqual(ranking.providers);
    expect(artefact.bronnen).toEqual(ranking.bronnen);
    // query-specific, from the view
    expect(artefact.hap.length).toBeGreaterThan(0);
    expect(artefact.recommendation.default.length).toBeGreaterThan(0);
  });

  it("geeft null voor een slug zonder gepubliceerde view", () => {
    expect(projectArtefact(getRanking(), "bestaat-niet")).toBeNull();
  });

  it("listPublishedSlugs bevat de gepubliceerde query", () => {
    expect(listPublishedSlugs()).toContain(SLUG);
  });
});
