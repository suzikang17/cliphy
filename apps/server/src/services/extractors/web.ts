import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { fetchViaProxy } from "../../lib/proxy.js";

export interface WebClip {
  kind: "article" | "visual";
  title: string;
  siteName?: string;
  faviconUrl?: string;
  heroImageUrl?: string;
  excerpt?: string;
  content: string;
  readingTimeMin?: number;
}

const ARTICLE_MIN_CHARS = 500;
const WORDS_PER_MIN = 220;

function meta(document: Document, selector: string): string | undefined {
  const el = document.querySelector(selector) as {
    getAttribute(name: string): string | null;
  } | null;
  return el?.getAttribute("content") ?? el?.getAttribute("href") ?? undefined;
}

export function classifyAndBuild(html: string, url: string): WebClip {
  const { document } = parseHTML(html);
  const origin = safeOrigin(url);

  const ogTitle = meta(document as unknown as Document, 'meta[property="og:title"]');
  const siteName = meta(document as unknown as Document, 'meta[property="og:site_name"]');
  const heroImageUrl = meta(document as unknown as Document, 'meta[property="og:image"]');
  const description =
    meta(document as unknown as Document, 'meta[name="description"]') ??
    meta(document as unknown as Document, 'meta[property="og:description"]');
  const favicon =
    meta(document as unknown as Document, 'link[rel="icon"]') ??
    (origin ? `${origin}/favicon.ico` : undefined);

  const docTitle = (document as unknown as Document).title;

  // Readability mutates the document, so run it after scraping meta tags.
  const parsed = new Readability(document as unknown as Document).parse();
  const textContent = (parsed?.textContent ?? "").trim();
  const isArticle = textContent.length >= ARTICLE_MIN_CHARS;

  const title = (parsed?.title || ogTitle || docTitle || url).trim();

  if (isArticle) {
    const words = textContent.split(/\s+/).length;
    return {
      kind: "article",
      title,
      siteName: siteName ?? parsed?.siteName ?? undefined,
      faviconUrl: favicon,
      heroImageUrl,
      excerpt: (parsed?.excerpt ?? description ?? textContent.slice(0, 200)).trim() || undefined,
      content: textContent,
      readingTimeMin: Math.max(1, Math.round(words / WORDS_PER_MIN)),
    };
  }

  return {
    kind: "visual",
    title,
    siteName,
    faviconUrl: favicon,
    heroImageUrl,
    excerpt: description ?? undefined,
    content: "",
  };
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export async function extractWebClip(url: string): Promise<WebClip> {
  let res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; CliphyBot/1.0)" },
  });
  if (res.status === 403 || res.status === 429) {
    // Datacenter IP blocked — retry through the residential proxy.
    res = await fetchViaProxy(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; CliphyBot/1.0)" },
    });
  }
  if (!res.ok) throw new Error(`Failed to fetch page (${res.status}): ${url}`);
  const html = await res.text();
  return classifyAndBuild(html, url);
}
