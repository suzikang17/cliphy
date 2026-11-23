// Which of our apps a request came from, read off headers every installed
// version already sends. No app has to be updated for this to work.

export type ClientKind = "extension" | "web" | "mac" | "ios" | "android" | "other";

const WEB_HOSTS = /^https?:\/\/((www\.)?cliphy\.app|localhost|127\.0\.0\.1)(:\d+)?$/i;

export function clientOf(headers: {
  origin?: string | null;
  userAgent?: string | null;
}): ClientKind {
  const origin = headers.origin ?? "";
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) {
    return "extension";
  }
  // The Mac app's window is served from its own scheme.
  if (origin.startsWith("app://")) return "mac";
  if (WEB_HOSTS.test(origin)) return "web";
  if (origin) return "other";

  // The phone apps send no Origin; their network stacks name themselves.
  const ua = headers.userAgent ?? "";
  if (/okhttp|android/i.test(ua)) return "android";
  if (/CFNetwork|Darwin|iPhone|iPad|iOS/i.test(ua)) return "ios";
  return "other";
}
