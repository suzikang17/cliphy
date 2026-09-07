/**
 * Does this input look like a link the user wants bookmarked, or text they
 * want written into today's note? Deliberately strict: anything with a space,
 * or without a dot in its first token, is prose.
 */
export function looksLikeUrl(input: string): boolean {
  const text = input.trim();
  if (!text || /\s/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return true;
  // Bare host like "linear.app" or "linear.app/inbox".
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(text);
}

/** Normalise a bare host to a full URL so the server always gets a real one. */
export function toUrl(input: string): string {
  const text = input.trim();
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}
