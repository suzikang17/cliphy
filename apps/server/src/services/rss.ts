// Parse <itunes:duration>: "HH:MM:SS", "MM:SS", or plain seconds as a string
function parseDuration(raw: string): number | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const parts = s.split(":");
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseInt(parts[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return undefined;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const s = parseInt(parts[1], 10);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return undefined;
    return m * 60 + s;
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

// Extract inner text from a named XML element — handles CDATA sections
function extractText(xml: string, tag: string): string | undefined {
  const m = xml.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`, "i"),
  );
  return (m?.[1] ?? m?.[2])?.trim() || undefined;
}

// Extract an attribute value from a (possibly self-closing) tag
function extractAttr(xml: string, tag: string, attr: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"'>]+)["']`, "i"));
  return m?.[1] || undefined;
}

export interface PodcastEpisodeInfo {
  guid: string;
  title: string;
  description?: string;
  audioUrl: string;
  artworkUrl?: string;
  durationSeconds?: number;
  publishedAt: string;
  transcriptUrl?: string;
}

/**
 * Fetch a podcast RSS URL, validate it's a real RSS/Atom feed, and return
 * feed-level metadata. Throws a descriptive error on failure.
 */
export async function parseFeedMetadata(
  url: string,
): Promise<{ title: string; author?: string; artworkUrl?: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new Error(`RSS feed unreachable: ${url} — ${(err as Error).message}`, { cause: err });
  }
  if (!res.ok) {
    throw new Error(`RSS feed returned HTTP ${res.status}: ${url}`);
  }
  const xml = await res.text();

  // Basic RSS/Atom validation
  const isRss = xml.includes("<rss") || xml.includes("<channel>");
  const isAtom =
    xml.includes("<feed") &&
    (xml.includes("http://www.w3.org/2005/Atom") || xml.includes("<entry>"));
  if (!isRss && !isAtom) {
    throw new Error(`URL does not appear to be a valid RSS/Atom feed: ${url}`);
  }

  // Narrow to the channel block to avoid false matches inside <item> elements
  const channelBlock =
    xml.match(/<channel>([\s\S]*?)<item>/)?.[1] ??
    xml.match(/<channel>([\s\S]*?)<\/channel>/)?.[1] ??
    xml;

  const title = extractText(channelBlock, "title") ?? "Untitled Podcast";
  const author = extractText(channelBlock, "itunes:author") ?? extractText(channelBlock, "author");

  // <itunes:image href="..."> or <image><url>...</url></image>
  const itunesArtwork = extractAttr(channelBlock, "itunes:image", "href");
  const imageBlockUrl = channelBlock.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/)?.[1];
  const artworkUrl = itunesArtwork ?? imageBlockUrl?.trim() ?? undefined;

  return { title, author, artworkUrl };
}

/**
 * Fetch a podcast RSS URL and return a list of episodes with their metadata.
 * Only episodes with an audio <enclosure> are included.
 */
export async function parseFeedEpisodes(url: string): Promise<PodcastEpisodeInfo[]> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new Error(`RSS feed unreachable: ${url} — ${(err as Error).message}`, { cause: err });
  }
  if (!res.ok) {
    throw new Error(`RSS feed returned HTTP ${res.status}: ${url}`);
  }
  const xml = await res.text();

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  const episodes: PodcastEpisodeInfo[] = [];

  for (const m of items) {
    const item = m[1];

    // Audio enclosure is required — skip non-audio items
    const audioUrlMatch =
      item.match(/<enclosure[^>]*\surl="([^"]+)"[^>]*\stype="audio[^"]*"/i) ??
      item.match(/<enclosure[^>]*\stype="audio[^"]*"[^>]*\surl="([^"]+)"/i);
    if (!audioUrlMatch) continue;
    const audioUrl = audioUrlMatch[1];

    const guid = extractText(item, "guid") ?? audioUrl; // fall back to URL if no <guid>
    const title = extractText(item, "title") ?? "Untitled Episode";
    const description = extractText(item, "itunes:summary") ?? extractText(item, "description");

    const artworkUrl = extractAttr(item, "itunes:image", "href") ?? undefined;

    const durationRaw = extractText(item, "itunes:duration");
    const durationSeconds = durationRaw ? parseDuration(durationRaw) : undefined;

    const pubDateRaw = extractText(item, "pubDate");
    let publishedAt: string;
    if (pubDateRaw) {
      const d = new Date(pubDateRaw);
      publishedAt = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    } else {
      publishedAt = new Date().toISOString();
    }

    // Podcast 2.0 namespace: <podcast:transcript url="..." type="...">
    const transcriptUrl = extractAttr(item, "podcast:transcript", "url") ?? undefined;

    episodes.push({
      guid,
      title,
      description,
      audioUrl,
      artworkUrl,
      durationSeconds,
      publishedAt,
      transcriptUrl,
    });
  }

  return episodes;
}

/** Strip SRT/VTT formatting to produce plain readable text. */
function stripSubtitleFormatting(text: string): string {
  let out = text.replace(/^WEBVTT[^\n]*\n/, "");
  // Remove timestamp lines: "00:00:00,000 --> 00:00:05,000"
  out = out.replace(/\d{1,2}:\d{2}:\d{2}[,.\d]* --> \d{1,2}:\d{2}:\d{2}[,.\d]*/g, "");
  // Remove standalone SRT sequence numbers
  out = out.replace(/^\d+\s*$/gm, "");
  // Strip any HTML/XML tags
  out = out.replace(/<[^>]+>/g, "");
  // Collapse excessive blank lines
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/**
 * Fetch a transcript file (SRT, VTT, or plain text) and return plain text.
 * Returns null on any failure or if the result is empty.
 */
export async function fetchTranscript(transcriptUrl: string): Promise<string | null> {
  try {
    const res = await fetch(transcriptUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const text = await res.text();
    const isSubtitle =
      text.trimStart().startsWith("WEBVTT") || /^\d+\s*\n\d{1,2}:\d{2}:\d{2}/m.test(text);
    const plain = isSubtitle ? stripSubtitleFormatting(text) : text.trim();
    return plain || null;
  } catch {
    return null;
  }
}
