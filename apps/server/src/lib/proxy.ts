import { ProxyAgent } from "undici";

export function fetchViaProxy(url: string, init?: RequestInit): Promise<Response> {
  const proxyUrl = process.env.PROXY_URL;

  if (!proxyUrl) {
    // Fall back to direct fetch if proxy not configured (local dev)
    return fetch(url, init);
  }

  const agent = new ProxyAgent(proxyUrl);

  return fetch(url, {
    ...init,
    // @ts-expect-error -- dispatcher is a Node.js/undici extension to Fetch API
    dispatcher: agent,
  });
}
