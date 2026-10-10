// Which closed tabs are worth keeping in the trail. Pure and synchronous: it
// runs on every tab close, so it only looks at the URL and timings — never the
// page. "Still open in another tab" is checked by the tracker, which can query.

/** Tabs closed sooner than this after opening are skipped (misclicks, quick peeks). */
export const MIN_OPEN_MS = 10_000;

/** Search engines, matched on the host without `www.` (so docs.google.com is not one). */
const SEARCH_HOSTS =
  /^(google\.[a-z.]+|bing\.com|duckduckgo\.com|html\.duckduckgo\.com|ecosia\.org|startpage\.com)$/;
const SEARCH_PATHS = /^\/(search|sp\/search|do\/search)(\/|$)/;

/** Path segments that mark sign-in / sign-out / sign-up flows: /login, /users/sign_in, /signin.php. */
const AUTH_SEGMENT =
  /^(log-?in|log_in|sign-?in|sign_in|sign-?up|sign_up|log-?out|sign-?out|oauth2?|sso)([._-]|$)/;
/** Host labels that mark identity providers (login.microsoftonline.com, sso.acme.com). */
const AUTH_HOST_LABELS = new Set(["login", "signin", "signup", "sso", "oauth", "auth"]);

export interface TrailCandidate {
  url: string;
  title: string;
  /** ms since epoch, when the open time is known. */
  openedAt?: number;
  closedAt: number;
}

function isNewTabPage(u: URL): boolean {
  // Chrome's Google-hosted new tab page.
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  return /^google\.[a-z.]+$/.test(host) && u.pathname.startsWith("/_/chrome/newtab");
}

export function isSearchPage(u: URL): boolean {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "search.yahoo.com" || host.endsWith(".search.yahoo.com")) return true;
  if (!SEARCH_HOSTS.test(host)) return false;
  if (u.searchParams.has("q")) return true;
  return SEARCH_PATHS.test(u.pathname.toLowerCase());
}

export function isAuthPage(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  if (host === "accounts.google.com") return true;
  if (host.split(".").some((label) => AUTH_HOST_LABELS.has(label))) return true;
  const path = u.pathname.toLowerCase();
  return path.includes("/auth/callback") || path.split("/").some((seg) => AUTH_SEGMENT.test(seg));
}

/** Should this closed tab be saved to the trail? */
export function shouldTrail({ url, openedAt, closedAt }: TrailCandidate): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (isNewTabPage(u) || isSearchPage(u) || isAuthPage(u)) return false;
  if (openedAt !== undefined && closedAt - openedAt < MIN_OPEN_MS) return false;
  return true;
}
