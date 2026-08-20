import type { CategorieRanking, Routing, SupportedCategory } from "@/lib/types";
import transcription from "@/data/transcription.ranking.json";
import tts from "@/data/tts.ranking.json";
import webSearch from "@/data/web-search.ranking.json";
import scraping from "@/data/scraping.ranking.json";
import ocr from "@/data/ocr.ranking.json";

// The categorie-registry (ADR 0010): the single place that loads every category-
// ranking from data/. The engine, gates, UI and endpoints all reach their data
// through here, so adding a focus category (TTS, web search, scraping, OCR) is a
// one-line registration plus its data file — no code branches per category.

const RANKINGS: CategorieRanking[] = [
  transcription as unknown as CategorieRanking,
  tts as unknown as CategorieRanking,
  webSearch as unknown as CategorieRanking,
  scraping as unknown as CategorieRanking,
  ocr as unknown as CategorieRanking,
];

// The first registered category is the default: transcription, the first focus
// category built out end-to-end (ADR 0004). The endpoints fall back to it when a
// free query carries no category signal (ADR 0010 point 3).
export const DEFAULT_CATEGORY = RANKINGS[0].category;

const BY_ID = new Map(RANKINGS.map((r) => [r.category, r] as const));

/** Every registered category-ranking, in registration order. */
export function listCategories(): CategorieRanking[] {
  return RANKINGS;
}

/**
 * The ranking for one category, or null if unknown. Defaults to the transcription
 * category when called with no argument, so single-category callers keep working
 * (ADR 0010). Callers decide what an unknown category means (404 / detect-fallback).
 */
export function getRanking(category: string = DEFAULT_CATEGORY): CategorieRanking | null {
  return BY_ID.get(category) ?? null;
}

// Deterministic, LLM-free keyword → category map (ADR 0009/0010 point 3). The
// page knows its category from the URL segment; the endpoints (/api/answer, MCP)
// get a free query with no category, so detection runs over this map. Each row
// is only consulted if that category is actually registered, so detection never
// points at a category with no data. New focus categories add their own row.
//
// FIX 1a (broaden recall): the keyword sets cover natural-language agent
// intents, not just exact registry bigrams — "look things up on the internet"
// (web-search), "sites that block bots" (scraping), "voice generation" (tts).
// Still pure substring matching, deterministic and testable (no LLM).
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["transcription", ["transcri", "speech-to-text", "speech to text", "stt", "asr", "subtitle", "caption", "diariz", "whisper", "audio to text", "audio into text", "audio to a transcript", "speech recognition", "voice recognition", "transcribe", "transcript of", "convert audio", "audio to written"]],
  ["tts", ["text-to-speech", "text to speech", "tts", "text2speech", "voice synthesis", "speech synthesis", "voice generation", "generate a voice", "generate speech", "generate audio from text", "voice cloning", "clone a voice", "voiceover", "voice over", "narration", "narrat", "audiobook", "read aloud", "read this aloud", "read text aloud", "speak the text", "aloud", "synthesize", "synthetic voice", "spraaksynthese"]],
  ["web-search", ["web search", "websearch", "search the web", "search the internet", "search engine api", "serp", "grounding", "ground my", "retrieval-augmented", "retrieval augmented", "web lookup", "look things up on the internet", "look up on the internet", "look it up online", "look things up online", "things up on the internet", "on the internet", "from the web", "data from the web", "real-time news", "real time news", "news freshness", "live web", "current information", "up-to-date information", "zoekmachine", "web-zoek"]],
  ["scraping", ["scrap", "crawl", "web unlocker", "anti-bot", "block bots", "blocks bots", "sites that block", "bypass bot", "captcha", "proxy api", "residential proxy", "headless browser", "browser automation", "automate a browser", "automate the browser", "fill out forms", "filling forms", "fill in forms", "spider", "scraper", "web-scraping", "extract data from a", "pull data from", "pull product data", "scrape", "from a web page", "from a webpage", "web page", "webpage", "from a url", "content from a url", "from a site", "from sites"]],
  ["ocr", ["ocr", "document extraction", "pdf", "pdf extraction", "pdf parsing", "document parsing", "parse a pdf", "parse a document", "document ai", "textract", "invoice", "invoice extraction", "receipt", "handwrit", "handwriting recognition", "scanned", "scanned document", "document intelligence", "extract text from", "read text from", "from an image", "image to text", "text from a photo", "from a photo", "digitize"]],
];

// The single keyword-scoring core (ADR 0010): one keyword hit ranks a category;
// the SCORE = how many distinct keywords from that category appear. Entries come
// out in CONFIG order (CATEGORY_KEYWORDS order), which is what lets matchCategory
// keep its config-order "first match wins" semantics on top of the same scan.
// routeCategory sorts these by score for its richer matched/none/ambiguous verdict.
// Everything that maps a query to a category now flows through here — no second,
// drifting keyword loop lives anywhere else.
function scoreCategories(query: string): Array<{ category: string; score: number }> {
  const q = query.toLowerCase();
  const scored: Array<{ category: string; score: number }> = [];
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (!BY_ID.has(category)) continue;
    const score = keywords.filter((k) => q.includes(k)).length;
    if (score > 0) scored.push({ category, score });
  }
  return scored;
}

/**
 * The first registered category whose keyword appears in the query, or null when
 * none matches. The honest "did this query land in any category?" signal — used
 * by the dashboard to surface demand gaps, since the events table always stores
 * the resolved (defaulted) category and so hides the misses.
 *
 * Consolidation (TASK 5): this is now a thin wrapper over the shared
 * scoreCategories core instead of its own keyword loop — that duplicate loop was
 * the drift hazard. Because scoreCategories yields matches in config order, the
 * first entry is exactly the "first row to match wins" result this always had, so
 * observable behavior (and the demand-gap metric) is unchanged.
 *
 * NB: it deliberately does NOT delegate to `routeCategory().category ?? null`.
 * routeCategory returns null on an ambiguous tie, which would silently reclassify
 * ambiguous queries as demand-gaps in the dashboard — a behavior change. Keeping
 * config-order-first preserves the current contract; richer ambiguity is
 * routeCategory's job.
 */
export function matchCategory(query: string): string | null {
  return scoreCategories(query)[0]?.category ?? null;
}

/**
 * Every registered category whose keywords appear in the query, ordered by score
 * (most keyword hits first), ties broken by config order. Empty = a gap. The
 * basis for ambiguity detection: 1 result = confident, 2+ tied-at-the-top =
 * ambiguous (FIX 1b).
 */
export function matchCategories(query: string): string[] {
  return [...scoreCategories(query)].sort((a, b) => b.score - a.score).map((s) => s.category);
}

/** The supported-category catalogue (id + label) for a no-match / disambiguation reply. */
export function supportedCategories(): SupportedCategory[] {
  return RANKINGS.map((r) => ({ category: r.category, label: r.label }));
}

export interface RouteResult {
  routing: Routing;
  category: string | null; // the resolved category for "matched", else null
  categories: SupportedCategory[]; // the supported catalogue (always present)
}

/**
 * Honest routing for a free query (FIX 1). Unlike detectCategory, it NEVER
 * fabricates a default: when no keyword matches it reports routing:"none"; when
 * one category clearly leads it reports "matched"; when 2+ categories tie at the
 * top score with no tiebreak it reports "ambiguous". The supported catalogue
 * always rides along so a no-match/ambiguous reply can list the in-scope options.
 */
export function routeCategory(query: string): RouteResult {
  const catalogue = supportedCategories();
  const scored = scoreCategories(query).sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    return { routing: "none", category: null, categories: catalogue };
  }
  const top = scored[0].score;
  const leaders = scored.filter((s) => s.score === top);
  if (leaders.length > 1) {
    // 2+ categories tie at the top with no tiebreak: flag it, list only the
    // candidates so the agent can disambiguate.
    const ids = new Set(leaders.map((l) => l.category));
    return {
      routing: "ambiguous",
      category: null,
      categories: catalogue.filter((c) => ids.has(c.category)),
    };
  }
  return { routing: "matched", category: scored[0].category, categories: catalogue };
}

/**
 * Pick the category for a free query. Returns the matched category, else the
 * DEFAULT_CATEGORY — so a legacy caller always has a category. Kept for the
 * dashboard/back-compat; the consumer endpoints now route via routeCategory so a
 * no-match is honest instead of a silent transcription answer (FIX 1).
 *
 * Thin wrapper (TASK 5): matchCategory → scoreCategories, so this shares the one
 * keyword-scoring core with routeCategory; it only adds the legacy default.
 */
export function detectCategory(query: string): string {
  return matchCategory(query) ?? DEFAULT_CATEGORY;
}
