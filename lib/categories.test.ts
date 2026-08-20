import { describe, it, expect } from "vitest";
import {
  getRanking,
  listCategories,
  DEFAULT_CATEGORY,
  detectCategory,
  matchCategory,
  matchCategories,
  routeCategory,
  supportedCategories,
} from "@/lib/categories";
import { checkRanking } from "@/lib/gates";

// The categorie-registry (ADR 0010): the single load-point for every category.
describe("categorie-registry", () => {
  it("registreert ten minste de transcription-categorie", () => {
    expect(listCategories().map((r) => r.category)).toContain("transcription");
  });

  it("de default-categorie is transcription (de volledig uitgebouwde focus-categorie)", () => {
    expect(DEFAULT_CATEGORY).toBe("transcription");
  });

  it("getRanking(id) geeft de ranking van die categorie", () => {
    expect(getRanking("transcription")!.label).toBe("Transcription");
  });

  it("getRanking() zonder argument geeft de default-categorie", () => {
    expect(getRanking()!.category).toBe(DEFAULT_CATEGORY);
  });

  it("getRanking(onbekend) geeft null — de aanroeper beslist (404 / detect-fallback)", () => {
    expect(getRanking("bestaat-niet")).toBeNull();
  });

  it("elke geregistreerde ranking passeert zijn eigen kwaliteitspoorten (ADR 0007)", () => {
    // Registry-level honesty floor: adding a category (D1-D4) that fails the
    // poorten turns this red, so nothing ships below the floor.
    for (const r of listCategories()) {
      expect(checkRanking(r).failures).toEqual([]);
    }
  });
});

// detectCategory maps a free, category-less query (the endpoint path) to a
// registered category by keyword, else the default (ADR 0009/0010 point 3).
describe("detectCategory", () => {
  it("routeert elke focus-categorie naar zichzelf", () => {
    expect(detectCategory("best transcription API for Dutch")).toBe("transcription");
    expect(detectCategory("cheapest text-to-speech API")).toBe("tts");
    expect(detectCategory("best web search API for agents")).toBe("web-search");
    expect(detectCategory("cheapest web scraping API")).toBe("scraping");
    expect(detectCategory("most accurate OCR API")).toBe("ocr");
  });

  it("valt terug op de default-categorie bij een query zonder categorie-signaal", () => {
    expect(detectCategory("what is the best api")).toBe(DEFAULT_CATEGORY);
  });

  it("laat 'most' NIET naar tts lekken (de 'MOS'-keyword is gescrubd)", () => {
    // Substring matching would route "most ..." to tts via a bare "MOS" token.
    expect(detectCategory("most popular api this year")).toBe(DEFAULT_CATEGORY);
  });
});

// Bevinding A1 (dogfood): the keyword map was too literal, so natural agent
// phrasings missed and fell back to transcription — a confident WRONG-domain
// answer (e.g. a PDF-extraction query got a speech-to-text tool). Routing must
// recognise everyday phrasings, not just exact registry bigrams.
describe("detectCategory — natural-language routing (Bevinding A1)", () => {
  it("routes a PDF text-extraction query to OCR, not transcription", () => {
    expect(detectCategory("extract text from a scanned PDF")).toBe("ocr");
  });

  // The dogfood misses: everyday phrasings that previously defaulted to
  // transcription. Each must now land in its true category.
  const corpus: ReadonlyArray<readonly [string, string]> = [
    ["transcription", "turn audio into text"],
    ["transcription", "speech recognition for a meeting"],
    ["tts", "read this text aloud"],
    ["tts", "synthesize a natural voice"],
    ["tts", "narrate an audiobook"],
    ["web-search", "search the web for an agent"],
    ["web-search", "real-time web lookup"],
    ["scraping", "extract data from a web page"],
    ["scraping", "get content from a url"],
    ["scraping", "automate a browser to click"],
    ["ocr", "extract text from a PDF"],
    ["ocr", "read text from an image"],
    ["ocr", "convert a scanned invoice to text"],
    ["ocr", "parse a PDF document"],
    ["ocr", "get data out of a receipt photo"],
    ["ocr", "digitize a handwritten note"],
  ];
  for (const [expected, query] of corpus) {
    it(`routes "${query}" → ${expected}`, () => {
      expect(detectCategory(query)).toBe(expected);
    });
  }

  it("does not over-match: ambiguous/out-of-scope queries stay a gap", () => {
    expect(matchCategory("image generation api")).toBeNull(); // 'image' alone must not hit OCR
    expect(matchCategory("what is the best api")).toBeNull();
    expect(detectCategory("most popular api this year")).toBe(DEFAULT_CATEGORY);
  });
});

// matchCategory is detectCategory WITHOUT the default fallback: null means "no
// category keyword matched" — the demand-gap signal the dashboard surfaces, since
// the events table always stores the resolved (defaulted) category.
describe("matchCategory", () => {
  it("returns the matched category for an in-scope query", () => {
    expect(matchCategory("cheapest web scraping API")).toBe("scraping");
    expect(matchCategory("most accurate OCR API")).toBe("ocr");
  });

  it("returns null when no category keyword matches (a gap)", () => {
    expect(matchCategory("what is the best api")).toBeNull();
    expect(matchCategory("image generation api")).toBeNull();
  });
});

// FIX 1 (a): broaden recall — natural-language agent intents must route to the
// right category, not silently fall to transcription. These are the prompt's
// must-route phrasings.
describe("routeCategory — natural-language intent routing (FIX 1a)", () => {
  const webSearch: ReadonlyArray<string> = [
    "I'm building an AI agent and need it to look things up on the internet",
    "API to get data from the web",
    "web search API with real-time news freshness",
  ];
  for (const q of webSearch) {
    it(`routes "${q}" → web-search (matched)`, () => {
      const r = routeCategory(q);
      expect(r.routing).toBe("matched");
      expect(r.category).toBe("web-search");
    });
  }

  const scraping: ReadonlyArray<string> = [
    "pull product data from sites that block bots",
    "headless browser automation for filling forms",
  ];
  for (const q of scraping) {
    it(`routes "${q}" → scraping (matched)`, () => {
      const r = routeCategory(q);
      expect(r.routing).toBe("matched");
      expect(r.category).toBe("scraping");
    });
  }

  it("routes 'best text to speech / voice generation' → tts", () => {
    expect(routeCategory("best text to speech voice generation").category).toBe("tts");
  });

  it("routes 'transcribe audio / speech to text' → transcription", () => {
    expect(routeCategory("speech to text to transcribe audio").category).toBe("transcription");
  });
});

// FIX 1 (b): honest no-match. Gibberish / out-of-scope must NOT fabricate a
// transcription answer; routeCategory reports routing:"none" with the supported
// list, never a defaulted category.
describe("routeCategory — honest no-match (FIX 1b)", () => {
  it("gibberish is routing:none, no category", () => {
    const r = routeCategory("asdfqwer zxcv");
    expect(r.routing).toBe("none");
    expect(r.category).toBeNull();
    expect(r.categories.map((c) => c.category)).toContain("transcription");
    expect(r.categories).toHaveLength(5);
  });

  it("out-of-scope ('best image generation API') is routing:none, not transcription", () => {
    const r = routeCategory("best image generation API");
    expect(r.routing).toBe("none");
    expect(r.category).toBeNull();
  });

  it("flags ambiguity when an intent matches 2+ categories with no tiebreak", () => {
    const r = routeCategory("fresh information from the web for my AI agent");
    expect(["matched", "ambiguous"]).toContain(r.routing);
    // ambiguous web-search/scraping is acceptable per the decision, but it must
    // never silently become transcription.
    if (r.routing === "matched") expect(["web-search", "scraping"]).toContain(r.category);
    if (r.routing === "ambiguous") {
      const ids = r.categories.map((c) => c.category);
      expect(ids).toContain("web-search");
      expect(ids).toContain("scraping");
    }
  });
});

describe("matchCategories — all matching categories (for ambiguity detection)", () => {
  it("returns a single category for an unambiguous query", () => {
    expect(matchCategories("most accurate OCR API")).toEqual(["ocr"]);
  });

  it("returns an empty array for a gap", () => {
    expect(matchCategories("best image generation API")).toEqual([]);
  });

  it("can return more than one category for an ambiguous intent", () => {
    const ids = matchCategories("fresh information from the web for my AI agent");
    // Either a single confident match or both candidates — never zero, never
    // transcription.
    expect(ids).not.toContain("transcription");
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe("supportedCategories — the honest catalogue for a no-match reply", () => {
  it("lists all five focus categories with id + label", () => {
    const cats = supportedCategories();
    expect(cats).toHaveLength(5);
    const ids = cats.map((c) => c.category);
    expect(ids).toEqual(["transcription", "tts", "web-search", "scraping", "ocr"]);
    for (const c of cats) expect(c.label.length).toBeGreaterThan(0);
  });
});
