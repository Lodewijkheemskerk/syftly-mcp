import { describe, it, expect } from "vitest";
import { parseAndCheckRanking } from "@/lib/ingest";
import { getRanking } from "@/lib/ranking";

// parseAndCheckRanking is the boundary between an untrusted candidate ranking
// (pasted from a manual recept-run, or later produced by the LLM pipeline) and
// the published ranking: parse -> structural guard -> quality gates. It never
// throws on garbage; it returns clean failures so the kill-switch can act.
describe("parseAndCheckRanking — kandidaat-ranking valideren", () => {
  it("accepteert de echte ranking (als object en als JSON-string)", () => {
    const asObject = parseAndCheckRanking(getRanking());
    expect(asObject.ok).toBe(true);

    const asString = parseAndCheckRanking(JSON.stringify(getRanking()));
    expect(asString.ok).toBe(true);
    if (asString.ok) expect(asString.ranking.category).toBe("transcription");
  });

  it("weigert ongeldige JSON met een parse-fout", () => {
    const result = parseAndCheckRanking("{niet-json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.some((f) => f.gate === "parse")).toBe(true);
  });

  it("weigert een verkeerde vorm met een structuur-fout (poorten crashen niet)", () => {
    // Missing providers/bronnen/queries: the value-gates would throw on this;
    // the structural guard must catch it first and report cleanly.
    const result = parseAndCheckRanking({ category: "transcriptie" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.some((f) => f.gate === "structuur")).toBe(true);
  });

  it("weigert een welgevormde maar inhoudelijk foute ranking via de poorten", () => {
    const bad = JSON.parse(JSON.stringify(getRanking()));
    bad.providers[0].prijs.waarde = -1;
    const result = parseAndCheckRanking(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.some((f) => f.gate === "provider-velden-compleet")).toBe(true);
    }
  });
});
