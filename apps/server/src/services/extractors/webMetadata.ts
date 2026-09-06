/**
 * Cheap head-only extraction for bookmark-tier clips: enough to render a tile,
 * with no Readability parse and no Claude call.
 */
export interface WebMetadata {
  title: string;
  siteName?: string;
  faviconUrl?: string;
  heroImageUrl?: string;
}

function meta(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  return re.exec(html)?.[1];
}

export async function extractWebMetadata(url: string): Promise<WebMetadata> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Cliphy/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = (await res.text()).slice(0, 200_000); // head is near the top

  const origin = new URL(url).origin;
  const iconPath = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i.exec(
    html,
  )?.[1];

  return {
    title: meta(html, "og:title") ?? /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]?.trim() ?? url,
    siteName: meta(html, "og:site_name"),
    faviconUrl: iconPath ? new URL(iconPath, origin).toString() : `${origin}/favicon.ico`,
    heroImageUrl: meta(html, "og:image"),
  };
}
