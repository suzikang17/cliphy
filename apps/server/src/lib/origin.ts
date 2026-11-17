/**
 * Whether the API answers a request, judged by its Origin header.
 *
 * A browser adds Origin to every cross-site request and to every write, even
 * a write to the page's own site. So the site's own pages must be let through
 * by comparing Origin with the address the request came to, or every save
 * made from cliphy.app is refused while every read works.
 *
 * `host` is the Host the request was sent to. `allowed` is ALLOWED_ORIGINS;
 * empty means no list is set (local development) and everyone is answered.
 */
export function originAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowed: string[],
): boolean {
  if (!origin || allowed.length === 0) return true;
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) {
    return true;
  }
  if (allowed.includes(origin)) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
