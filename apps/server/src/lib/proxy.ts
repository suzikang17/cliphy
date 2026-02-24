import { ProxyAgent } from "undici";

export function fetchViaProxy(url: string, init?: RequestInit): Promise<Response> {
  const username = process.env.WEBSHARE_PROXY_USERNAME;
  const password = process.env.WEBSHARE_PROXY_PASSWORD;

  if (!username || !password) {
    // Fall back to direct fetch if proxy not configured (local dev)
    return fetch(url, init);
  }

  const agent = new ProxyAgent({
    uri: "http://p.webshare.io:80",
    token: `Basic ${Buffer.from(`${username}-rotate:${password}`).toString("base64")}`,
  });

  return fetch(url, {
    ...init,
    // @ts-expect-error -- dispatcher is a Node.js/undici extension to Fetch API
    dispatcher: agent,
  });
}
