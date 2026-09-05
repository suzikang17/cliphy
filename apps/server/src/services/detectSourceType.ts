import { extractVideoId, type SourceType } from "@cliphy/shared";

const TWEET_HOSTS = new Set(["twitter.com", "x.com", "mobile.twitter.com"]);

/**
 * Classify a pasted/shared URL. YouTube and tweet URLs are recognized by
 * host + shape; everything else (including raw RSS feeds) falls back to "web".
 * Podcast ingestion happens via subscription flows, not this classifier.
 */
export function detectSourceType(url: string): SourceType {
  if (extractVideoId(url)) return "youtube";
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, "");
    if (TWEET_HOSTS.has(host) && /\/status\/\d+/.test(pathname)) {
      return "tweet";
    }
  } catch {
    return "web";
  }
  return "web";
}
