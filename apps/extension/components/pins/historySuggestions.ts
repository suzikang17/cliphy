export interface HistoryLike {
  url?: string;
  title?: string;
  visitCount?: number;
  typedCount?: number;
}

export interface SiteSuggestion {
  /** e.g. "https://linear.app" — what a tile links to. */
  origin: string;
  /** e.g. "linear.app" — the tile label. */
  host: string;
  score: number;
  visits: number;
}

/**
 * Hosts whose pages are search results, not destinations. Visiting them a
 * thousand times says nothing about what you want on your new tab.
 */
const SEARCH_HOSTS = new Set([
  "google.com",
  "bing.com",
  "duckduckgo.com",
  "search.yahoo.com",
  "baidu.com",
  "ecosia.org",
  "startpage.com",
]);

/** A typed visit is a much stronger signal of intent than a clicked one. */
const TYPED_WEIGHT = 3;

function hostOf(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Turn raw browser history into ranked site suggestions for the tile strip.
 * Grouped by host, because forty Linear issue pages are one site, not forty.
 */
export function rankSites(
  items: HistoryLike[],
  opts: { excludeOrigins?: string[]; limit?: number } = {},
): SiteSuggestion[] {
  const excluded = new Set(
    (opts.excludeOrigins ?? []).map((o) => hostOf(o)).filter((h): h is string => h !== null),
  );

  const byHost = new Map<string, { score: number; visits: number }>();

  for (const item of items) {
    if (!item.url) continue;
    const host = hostOf(item.url);
    if (!host || SEARCH_HOSTS.has(host) || excluded.has(host)) continue;

    const visits = item.visitCount ?? 0;
    const typed = item.typedCount ?? 0;
    const entry = byHost.get(host) ?? { score: 0, visits: 0 };
    entry.score += visits + typed * TYPED_WEIGHT;
    entry.visits += visits;
    byHost.set(host, entry);
  }

  return [...byHost.entries()]
    .map(([host, { score, visits }]) => ({
      host,
      origin: `https://${host}`,
      score,
      visits,
    }))
    .sort((a, b) => b.score - a.score || a.host.localeCompare(b.host))
    .slice(0, opts.limit ?? 10);
}
