import { ProxyAgent } from "undici";

/**
 * undici throws `TypeError: fetch failed` for any network-level failure and hides
 * the real reason on `.cause` (e.g. ECONNREFUSED, ENOTFOUND, ConnectTimeoutError).
 * Pull that out into a readable string so it survives error propagation and shows
 * up in logs / Sentry / the admin error panel instead of a bare "fetch failed".
 */
function describeFetchError(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause;
  if (cause && typeof cause === "object") {
    const code = (cause as { code?: string }).code;
    const message = (cause as { message?: string }).message;
    return [code, message].filter(Boolean).join(": ") || String(cause);
  }
  return err instanceof Error ? err.message : String(err);
}

export async function fetchViaProxy(url: string, init?: RequestInit): Promise<Response> {
  const proxyUrl = process.env.PROXY_URL;

  try {
    if (!proxyUrl) {
      // Fall back to direct fetch if proxy not configured (local dev)
      return await fetch(url, init);
    }

    const agent = new ProxyAgent(proxyUrl);

    return await fetch(url, {
      ...init,
      // @ts-expect-error -- dispatcher is a Node.js/undici extension to Fetch API
      dispatcher: agent,
    });
  } catch (err) {
    const hostname = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    })();
    const via = proxyUrl ? " via proxy" : "";
    throw new Error(`Network request to ${hostname} failed${via}: ${describeFetchError(err)}`, {
      cause: err,
    });
  }
}
