import { POSTHOG_HOST, POSTHOG_KEY } from "@cliphy/shared";

// Product analytics from the extension (PostHog, ADR 0073): that it was
// installed, that someone tried to sign in or save, and whether it worked.
// Sent with a plain request, so it works in the background worker and loads
// no outside code. No page addresses, titles or content are ever sent; a
// signed-in person is their account id, anyone else a random id made on
// install and kept in the extension's own storage.

const INSTALL_ID_KEY = "analyticsInstallId";
// The key lib/auth.ts stores the sign-in token under.
const ACCESS_TOKEN_KEY = "cliphy_access_token";

export type AnalyticsProps = Record<string, string | number | boolean | null>;

interface Storage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface AnalyticsDeps {
  storage: Storage;
  send: (body: unknown) => Promise<unknown>;
  enabled: boolean;
  version: string;
  newId: () => string;
}

/** The account id inside a sign-in token, without checking the token. */
export function accountIdOf(token: unknown): string | null {
  if (typeof token !== "string") return null;
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const sub = (JSON.parse(atob(base64)) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}

export function createAnalytics(deps: AnalyticsDeps) {
  async function installId(): Promise<string> {
    const stored = (await deps.storage.get(INSTALL_ID_KEY))[INSTALL_ID_KEY];
    if (typeof stored === "string" && stored) return stored;
    const id = deps.newId();
    await deps.storage.set({ [INSTALL_ID_KEY]: id });
    return id;
  }

  async function capture(distinctId: string, event: string, properties: AnalyticsProps) {
    await deps.send({
      api_key: POSTHOG_KEY,
      event,
      distinct_id: distinctId,
      properties: {
        ...properties,
        client: "extension",
        version: deps.version,
        $lib: "cliphy-extension",
      },
      timestamp: new Date().toISOString(),
    });
  }

  return {
    /** Record one event. Never throws: analytics must not break the extension. */
    async track(event: string, props: AnalyticsProps = {}): Promise<void> {
      if (!deps.enabled) return;
      try {
        const token = (await deps.storage.get(ACCESS_TOKEN_KEY))[ACCESS_TOKEN_KEY];
        await capture(accountIdOf(token) ?? (await installId()), event, props);
      } catch {
        // Dropped.
      }
    },

    /**
     * After a sign-in: tell PostHog that this install and this account are the
     * same person, so "installed" and "signed in" land on one timeline.
     */
    async linkAccount(): Promise<void> {
      if (!deps.enabled) return;
      try {
        const token = (await deps.storage.get(ACCESS_TOKEN_KEY))[ACCESS_TOKEN_KEY];
        const accountId = accountIdOf(token);
        if (!accountId) return;
        await capture(accountId, "$identify", { $anon_distinct_id: await installId() });
      } catch {
        // Dropped.
      }
    },
  };
}

/** Why a save failed, as a short code. The error's words are not sent. */
export function saveFailureReason(err: unknown): string {
  // The API client's own errors carry a code (class names do not survive minifying).
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "rate_limited" || code === "pro_required") return code;
  const message = err instanceof Error ? err.message : String(err);
  if (/already queued/i.test(message)) return "duplicate";
  if (/failed to fetch|network/i.test(message)) return "network";
  if (/not authenticated|unauthorized|401/i.test(message)) return "signed_out";
  return "error";
}

const live = createAnalytics({
  storage: {
    get: (key) => browser.storage.local.get(key),
    set: (items) => browser.storage.local.set(items),
  },
  // keepalive: the background worker can be stopped before a normal request finishes.
  send: (body) =>
    fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }),
  // Only a built, published extension reports: not `wxt dev`.
  enabled: import.meta.env.PROD,
  version: (() => {
    try {
      return browser.runtime.getManifest().version;
    } catch {
      return "unknown";
    }
  })(),
  newId: () => crypto.randomUUID(),
});

export const track = (event: string, props?: AnalyticsProps) => void live.track(event, props);
export const linkAccount = () => void live.linkAccount();
