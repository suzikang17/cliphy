import { logger } from "../lib/logger.js";
import { fetchViaProxy } from "../lib/proxy.js";

const log = logger.child({ service: "metadata" });

export interface VideoMetadata {
  title?: string;
  channel?: string;
}

/**
 * Fetch a video's title + channel from YouTube's public oEmbed endpoint.
 * No API key required. Routed through the proxy because YouTube blocks
 * datacenter IPs. Returns {} on any failure so callers can fall back to
 * client-supplied values (or "Untitled Video") without breaking the queue add.
 */
export async function fetchVideoMetadata(videoUrl: string): Promise<VideoMetadata> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetchViaProxy(oembedUrl, { signal: controller.signal });
    if (!res.ok) {
      // 401/404 = private/deleted/unembeddable video — expected, not an error
      log.warn("oEmbed non-OK response", { status: res.status });
      return {};
    }

    const data = (await res.json()) as { title?: string; author_name?: string };
    return {
      title: data.title?.trim() || undefined,
      channel: data.author_name?.trim() || undefined,
    };
  } catch (err) {
    log.warn("oEmbed fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  } finally {
    clearTimeout(timeout);
  }
}
