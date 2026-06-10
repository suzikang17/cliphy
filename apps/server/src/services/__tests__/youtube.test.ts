import { describe, it, expect, vi, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => vi.clearAllMocks());

const { fetchChannelVideos, fetchLikedVideos, fetchMyPlaylists, fetchPlaylistVideos, parseSourceUrl } =
  await import("../youtube.js");

describe("fetchChannelVideos", () => {
  it("parses RSS feed and returns video previews", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <entry>
    <yt:videoId>abc123</yt:videoId>
    <title>Test Video</title>
    <published>2024-01-15T10:00:00+00:00</published>
    <author><name>Test Channel</name></author>
  </entry>
  <entry>
    <yt:videoId>def456</yt:videoId>
    <title>Another Video</title>
    <published>2024-01-14T10:00:00+00:00</published>
    <author><name>Test Channel</name></author>
  </entry>
</feed>`,
    });

    const videos = await fetchChannelVideos("UCtest123");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCtest123",
    );
    expect(videos).toHaveLength(2);
    expect(videos[0]).toEqual({
      videoId: "abc123",
      title: "Test Video",
      publishedAt: "2024-01-15T10:00:00+00:00",
      channelTitle: "Test Channel",
    });
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(fetchChannelVideos("UCbad")).rejects.toThrow("YouTube RSS error: 404");
  });

  it("returns empty array when feed has no entries", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?><feed></feed>`,
    });
    const videos = await fetchChannelVideos("UCempty");
    expect(videos).toHaveLength(0);
  });
});

describe("fetchPlaylistVideos", () => {
  it("fetches playlist items with API key when no token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            snippet: {
              resourceId: { videoId: "vid1" },
              title: "Playlist Video",
              publishedAt: "2024-02-01T00:00:00Z",
              videoOwnerChannelTitle: "Some Channel",
            },
          },
        ],
      }),
    });

    const videos = await fetchPlaylistVideos("PLtest123");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("playlistId=PLtest123");
    expect(videos).toHaveLength(1);
    expect(videos[0].videoId).toBe("vid1");
    expect(videos[0].channelTitle).toBe("Some Channel");
  });

  it("uses Bearer token when accessToken provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    });

    await fetchPlaylistVideos("WL", "mytoken");

    const calledHeaders = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(calledHeaders["Authorization"]).toBe("Bearer mytoken");
  });

  it("returns empty array when items is absent", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const videos = await fetchPlaylistVideos("PLempty");
    expect(videos).toHaveLength(0);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(fetchPlaylistVideos("PLbad")).rejects.toThrow("YouTube API error: 403");
  });
});

describe("fetchLikedVideos", () => {
  it("maps videos.list myRating=like response to previews", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "vid123",
            snippet: {
              title: "Liked Video",
              publishedAt: "2026-01-01T00:00:00Z",
              channelTitle: "Some Channel",
            },
          },
        ],
      }),
    });

    const videos = await fetchLikedVideos("token-abc");

    expect(videos).toEqual([
      {
        videoId: "vid123",
        title: "Liked Video",
        publishedAt: "2026-01-01T00:00:00Z",
        channelTitle: "Some Channel",
      },
    ]);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("myRating=like");
    const calledHeaders = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(calledHeaders["Authorization"]).toBe("Bearer token-abc");
  });

  it("returns empty array when items is absent", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const videos = await fetchLikedVideos("token-abc");
    expect(videos).toHaveLength(0);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(fetchLikedVideos("token-abc")).rejects.toThrow("YouTube API error: 403");
  });
});

describe("fetchMyPlaylists", () => {
  it("lists the user's own playlists with OAuth", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { id: "PLcliphy1", snippet: { title: "Cliphy" } },
          { id: "PLother", snippet: { title: "Workout Mixes" } },
        ],
      }),
    });

    const playlists = await fetchMyPlaylists("token-abc");

    expect(playlists).toEqual([
      { playlistId: "PLcliphy1", title: "Cliphy" },
      { playlistId: "PLother", title: "Workout Mixes" },
    ]);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("mine=true");
    const calledHeaders = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(calledHeaders["Authorization"]).toBe("Bearer token-abc");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(fetchMyPlaylists("token-abc")).rejects.toThrow("YouTube API error: 401");
  });
});

describe("parseSourceUrl", () => {
  it("returns watch_later for WL playlist URL", async () => {
    const result = await parseSourceUrl("https://www.youtube.com/playlist?list=WL");
    expect(result.type).toBe("watch_later");
    expect(result.sourceId).toBe("WL");
    expect(result.sourceName).toBe("Watch Later");
    expect(result.sourceUrl).toBeNull();
  });

  it("extracts playlist ID from playlist URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [{ snippet: { title: "My Playlist" } }] }),
    });

    const result = await parseSourceUrl("https://www.youtube.com/playlist?list=PLabc123");
    expect(result.type).toBe("playlist");
    expect(result.sourceId).toBe("PLabc123");
    expect(result.sourceName).toBe("My Playlist");
  });

  it("extracts channel ID from /channel/ URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [{ snippet: { title: "My Channel" } }] }),
    });

    const result = await parseSourceUrl("https://www.youtube.com/channel/UCabc123");
    expect(result.type).toBe("channel");
    expect(result.sourceId).toBe("UCabc123");
  });

  it("resolves @handle to channel ID", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ id: "UCresolved", snippet: { title: "Handle Channel" } }],
      }),
    });

    const result = await parseSourceUrl("https://www.youtube.com/@myhandle");
    expect(result.type).toBe("channel");
    expect(result.sourceId).toBe("UCresolved");
    expect(result.sourceName).toBe("Handle Channel");
  });

  it("throws on unsupported URL format", async () => {
    await expect(parseSourceUrl("https://www.youtube.com/watch?v=abc")).rejects.toThrow(
      "Unsupported YouTube URL format",
    );
  });
});
