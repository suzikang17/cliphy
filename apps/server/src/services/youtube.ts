const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? "";

export interface YouTubeVideoPreview {
  videoId: string;
  title: string;
  publishedAt: string;
  channelTitle?: string;
}

export interface ResolvedSource {
  type: "channel" | "playlist" | "watch_later";
  sourceId: string | null;
  sourceName: string;
  sourceUrl: string | null;
}

export async function parseSourceUrl(url: string, accessToken?: string): Promise<ResolvedSource> {
  const u = new URL(url);
  const listParam = u.searchParams.get("list");

  if (listParam === "WL") {
    return { type: "watch_later", sourceId: "WL", sourceName: "Watch Later", sourceUrl: null };
  }

  if (u.pathname === "/playlist" && listParam) {
    const name = await resolvePlaylistName(listParam, accessToken);
    return { type: "playlist", sourceId: listParam, sourceName: name, sourceUrl: url };
  }

  if (u.pathname.startsWith("/channel/")) {
    const channelId = u.pathname.split("/channel/")[1].split("/")[0];
    const name = await resolveChannelName(channelId);
    return { type: "channel", sourceId: channelId, sourceName: name, sourceUrl: url };
  }

  if (u.pathname.startsWith("/@")) {
    const handle = u.pathname.slice(2).split("/")[0];
    const result = await resolveChannelHandle(handle);
    return { type: "channel", sourceId: result.channelId, sourceName: result.name, sourceUrl: url };
  }

  throw new Error("Unsupported YouTube URL format");
}

async function resolveChannelHandle(handle: string): Promise<{ channelId: string; name: string }> {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${encodeURIComponent(handle)}&key=${YOUTUBE_API_KEY}`,
  );
  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
  const data = (await res.json()) as {
    items?: Array<{ id: string; snippet: { title: string } }>;
  };
  const item = data.items?.[0];
  if (!item) throw new Error(`Channel not found: @${handle}`);
  return { channelId: item.id, name: item.snippet.title };
}

async function resolveChannelName(channelId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${YOUTUBE_API_KEY}`,
  );
  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
  const data = (await res.json()) as {
    items?: Array<{ snippet: { title: string } }>;
  };
  return data.items?.[0]?.snippet.title ?? channelId;
}

async function resolvePlaylistName(playlistId: string, accessToken?: string): Promise<string> {
  const headers: Record<string, string> = {};
  const params = new URLSearchParams({ part: "snippet", id: playlistId });
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  } else {
    params.set("key", YOUTUBE_API_KEY);
  }
  const res = await fetch(`https://www.googleapis.com/youtube/v3/playlists?${params}`, {
    headers,
  });
  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
  const data = (await res.json()) as {
    items?: Array<{ snippet: { title: string } }>;
  };
  return data.items?.[0]?.snippet.title ?? playlistId;
}

export async function fetchChannelVideos(channelId: string): Promise<YouTubeVideoPreview[]> {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!res.ok) throw new Error(`YouTube RSS error: ${res.status}`);
  const xml = await res.text();
  return parseRssFeed(xml);
}

function parseRssFeed(xml: string): YouTubeVideoPreview[] {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries
    .map((m) => {
      const entry = m[1];
      const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] ?? "";
      const title = entry.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
      const publishedAt =
        entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? new Date().toISOString();
      const channelTitle = entry.match(/<name>([^<]+)<\/name>/)?.[1];
      return { videoId, title, publishedAt, channelTitle };
    })
    .filter((v) => v.videoId);
}

export async function fetchPlaylistVideos(
  playlistId: string,
  accessToken?: string,
): Promise<YouTubeVideoPreview[]> {
  const headers: Record<string, string> = {};
  const params = new URLSearchParams({
    part: "snippet",
    playlistId,
    maxResults: "50",
  });
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  } else {
    params.set("key", YOUTUBE_API_KEY);
  }

  const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`, {
    headers,
  });
  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
  const data = (await res.json()) as {
    items?: Array<{
      snippet: {
        resourceId: { videoId: string };
        title: string;
        publishedAt: string;
        videoOwnerChannelTitle?: string;
      };
    }>;
  };
  return (data.items ?? []).map((item) => ({
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title,
    publishedAt: item.snippet.publishedAt,
    channelTitle: item.snippet.videoOwnerChannelTitle,
  }));
}
