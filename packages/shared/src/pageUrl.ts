// Page identity shared by the extension (duplicates, per-page names/notes, caches)
// and the server (page_tags), so both agree on what "the same page" is.

/** Query params that only track where a click came from — never part of page identity. */
const TRACKING_PARAMS = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^si$/i, /^ref$/i, /^ref_src$/i];

/**
 * Page identity for duplicate detection: lowercase host without `www.`, no
 * `#hash`, no trailing slash (except root), tracking params stripped, remaining
 * params sorted. Meaningful params stay (youtube ?v=A ≠ ?v=B). null for non-web.
 */
export function normalizeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.some((re) => re.test(k)))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
  return `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}${path}${query}`;
}
