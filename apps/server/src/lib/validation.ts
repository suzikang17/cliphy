/** Max allowed lengths for user-supplied string inputs. */
export const MAX_LENGTHS = {
  videoTitle: 500,
  videoChannel: 200,
  searchQuery: 200,
} as const;

/**
 * Sanitize a search query before interpolation into a PostgREST `.or()` filter.
 * Strips characters that have special meaning in PostgREST filter syntax
 * (commas, dots, parens) and enforces a length limit.
 */
export function sanitizeSearchQuery(q: string): string {
  return q
    .replace(/[,.()"'\\]/g, "")
    .trim()
    .slice(0, MAX_LENGTHS.searchQuery);
}
