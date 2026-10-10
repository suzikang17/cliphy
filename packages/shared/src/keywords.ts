// Per-tag keywords: a deterministic "this text means this tag" rule used by the
// Tabs view before any AI. Matching ignores case, spaces and punctuation so
// "we curate life" finds wecuratelife-mockups.vercel.app and "WeCurateLife".
// Shared so the extension (instant, local) and server (skip Jev) agree exactly.

export const MAX_KEYWORDS_PER_TAG = 10;
export const MAX_KEYWORD_LENGTH = 40;
/** Compact keywords shorter than this must match a whole word ("ai" ≠ "mail"). */
const MIN_SUBSTRING_LENGTH = 4;

export interface KeywordHaystack {
  url: string;
  title: string;
  text?: string;
}

/** Lowercase letters and digits only (Unicode-aware). */
export function compactText(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

export function keywordMatches(keyword: string, hay: KeywordHaystack): boolean {
  const k = compactText(keyword);
  if (!k) return false;
  const fields = [hay.url, hay.title, hay.text ?? ""];
  if (k.length < MIN_SUBSTRING_LENGTH) return fields.some((f) => words(f).has(k));
  return fields.some((f) => compactText(f).includes(k));
}

/** The tag whose longest matching keyword is longest (most specific wins); null if none. */
export function matchKeywordTag(
  hay: KeywordHaystack,
  keywordsByTag: Record<string, string[]>,
): string | null {
  let best: { tag: string; len: number } | null = null;
  for (const [tag, keywords] of Object.entries(keywordsByTag)) {
    for (const kw of keywords) {
      const len = compactText(kw).length;
      if ((!best || len > best.len) && keywordMatches(kw, hay)) best = { tag, len };
    }
  }
  return best?.tag ?? null;
}

/** Clean user/AI-provided keywords: trimmed, lowercase, deduped by compact form, capped. */
export function normalizeKeywords(input: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const kw = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_KEYWORD_LENGTH);
    const compact = compactText(kw);
    if (!compact || seen.has(compact)) continue;
    seen.add(compact);
    out.push(kw);
    if (out.length === MAX_KEYWORDS_PER_TAG) break;
  }
  return out;
}

/** Every tag with a matching keyword (for clips, which can carry several tags), most specific first. */
export function matchAllKeywordTags(
  hay: KeywordHaystack,
  keywordsByTag: Record<string, string[]>,
): string[] {
  const hits: { tag: string; len: number }[] = [];
  for (const [tag, keywords] of Object.entries(keywordsByTag)) {
    let best = 0;
    for (const kw of keywords) {
      if (keywordMatches(kw, hay)) best = Math.max(best, compactText(kw).length);
    }
    if (best > 0) hits.push({ tag, len: best });
  }
  return hits.sort((a, b) => b.len - a.len).map((h) => h.tag);
}
