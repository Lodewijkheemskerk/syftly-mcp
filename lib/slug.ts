/**
 * Turn a human query into a url/lookup slug.
 * "Best transcription API for Dutch" -> "best-transcription-api-for-dutch".
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Turn a url slug back into a readable query for the engine (lossy — casing and
 * punctuation are gone, but the keyword-axis matching only needs the words).
 * "cheapest-transcription-api" -> "cheapest transcription api".
 */
export function deslugify(slug: string): string {
  return slug.replace(/-+/g, " ").trim();
}
