import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeDb, type FakeDb, type Op } from "../../routes/coach/__tests__/helpers.js";

// The weekly digest's choosing: which channels, which uploads, how close.

let db: FakeDb;
const rpc = vi.fn();
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => db.from(t), rpc: (...a: unknown[]) => rpc(...a) },
}));
const generateEmbeddings = vi.fn();
vi.mock("../embedding.js", () => ({
  generateEmbeddings: (...a: unknown[]) => generateEmbeddings(...a),
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const { rankChannels, pickCandidates, candidateText, scoreCandidates, findCandidates } =
  await import("../digest.js");

const NOW = new Date("2026-11-22T15:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const upload = (videoId: string, over: Record<string, unknown> = {}) => ({
  videoId,
  title: `Video ${videoId}`,
  publishedAt: daysAgo(1),
  channelTitle: "Chan",
  ...over,
});

beforeEach(() => {
  rpc.mockReset();
  generateEmbeddings.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rankChannels", () => {
  it("orders channels by how many videos were saved from each", () => {
    const videos = [
      { videoId: "1", channelId: "A", channelTitle: "Alpha" },
      { videoId: "2", channelId: "B", channelTitle: "Beta" },
      { videoId: "3", channelId: "B", channelTitle: "Beta" },
    ];
    expect(rankChannels(videos)).toEqual([
      { channelId: "B", channelTitle: "Beta", saved: 2 },
      { channelId: "A", channelTitle: "Alpha", saved: 1 },
    ]);
    expect(rankChannels(videos, 1)).toHaveLength(1);
  });
});

describe("pickCandidates", () => {
  it("keeps recent uploads, newest first, and drops Shorts, old, saved and repeated ones", () => {
    const picked = pickCandidates(
      [
        upload("old", { publishedAt: daysAgo(8) }),
        upload("short", { isShort: true }),
        upload("saved"),
        upload("two", { publishedAt: daysAgo(2) }),
        upload("one", { publishedAt: daysAgo(1) }),
        upload("one", { publishedAt: daysAgo(1) }),
        upload("future", { publishedAt: new Date(NOW + 3_600_000).toISOString() }),
      ],
      { now: NOW, known: new Set(["saved"]) },
    );
    expect(picked.map((c) => c.videoId)).toEqual(["one", "two"]);
  });

  it("takes at most three from one channel, and stops at the cap", () => {
    const busy = ["a", "b", "c", "d"].map((id, i) => upload(id, { publishedAt: daysAgo(i + 1) }));
    const other = upload("z", { channelTitle: "Other", publishedAt: daysAgo(6) });
    expect(
      pickCandidates([...busy, other], { now: NOW, known: new Set() }).map((c) => c.videoId),
    ).toEqual(["a", "b", "c", "z"]);
    expect(pickCandidates([...busy, other], { now: NOW, known: new Set(), max: 2 })).toHaveLength(
      2,
    );
  });

  it("keeps the start of a long description only", () => {
    const [c] = pickCandidates([upload("a", { description: "x".repeat(2000) })], {
      now: NOW,
      known: new Set(),
    });
    expect(c.description).toHaveLength(600);
    expect(candidateText({ ...c, description: "About espresso" })).toBe(
      "Video a\nChan\nAbout espresso",
    );
  });
});

describe("scoreCandidates", () => {
  it("embeds all uploads in one request and ranks them by their closest saved clip", async () => {
    const [far, near, none] = pickCandidates(
      [
        upload("far", { publishedAt: daysAgo(1) }),
        upload("near", { publishedAt: daysAgo(2) }),
        upload("none", { publishedAt: daysAgo(3) }),
      ],
      { now: NOW, known: new Set() },
    );
    generateEmbeddings.mockResolvedValue([[1], [2], [3]]);
    rpc
      .mockResolvedValueOnce({ data: [{ id: "clip-far", similarity: 0.41 }], error: null })
      .mockResolvedValueOnce({ data: [{ id: "clip-near", similarity: 0.83 }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const scored = await scoreCandidates("u1", [far, near, none]);

    expect(generateEmbeddings).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "match_clips",
      expect.objectContaining({ query_embedding: [2], match_user_id: "u1", match_count: 1 }),
    );
    expect(scored.map((s) => [s.videoId, s.score, s.becauseClipId])).toEqual([
      ["near", 0.83, "clip-near"],
      ["far", 0.41, "clip-far"],
      ["none", 0, null],
    ]);
  });

  it("fails loudly when the comparison fails, so the job retries", async () => {
    generateEmbeddings.mockResolvedValue([[1]]);
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const [c] = pickCandidates([upload("a")], { now: NOW, known: new Set() });
    await expect(scoreCandidates("u1", [c])).rejects.toThrow("match_clips failed: boom");
  });
});

describe("findCandidates", () => {
  const feed = (entries: string) => `<feed>${entries}</feed>`;
  const entry = (id: string, href: string, published: string) => `<entry>
    <yt:videoId>${id}</yt:videoId><title>Tom &amp; ${id}</title>
    <link rel="alternate" href="${href}"/>
    <author><name>Chan</name></author><published>${published}</published>
    <media:group><media:description>About ${id}</media:description></media:group>
  </entry>`;

  it("reads the feeds of the channels saved from, skipping what is already saved or shown", async () => {
    db = makeDb((op: Op) => {
      if (op.table === "digest_items") return { data: [{ youtube_video_id: "shown" }] };
      // Both the "recently saved" and the "everything saved" lookups.
      return { data: [{ youtube_video_id: "saved1" }, { youtube_video_id: "saved2" }] };
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/youtube/v3/videos")) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: "saved1", snippet: { channelId: "UC1", channelTitle: "Chan" } },
              { id: "saved2", snippet: { channelId: "UC1", channelTitle: "Chan" } },
            ],
          }),
        };
      }
      return {
        ok: true,
        text: async () =>
          feed(
            entry("new", "https://www.youtube.com/watch?v=new", daysAgo(1)) +
              entry("clip", "https://www.youtube.com/shorts/clip", daysAgo(1)) +
              entry("shown", "https://www.youtube.com/watch?v=shown", daysAgo(2)) +
              entry("saved1", "https://www.youtube.com/watch?v=saved1", daysAgo(3)),
          ),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const found = await findCandidates("u1", NOW);

    expect(found).toEqual([
      {
        videoId: "new",
        title: "Tom & new",
        channelTitle: "Chan",
        publishedAt: daysAgo(1),
        description: "About new",
      },
    ]);
    // One lookup for both saved videos, one feed for their one channel.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("channel_id=UC1");
  });

  it("asks YouTube nothing when no videos were saved lately", async () => {
    db = makeDb(() => ({ data: [] }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await findCandidates("u1", NOW)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries on when one channel's feed cannot be read", async () => {
    db = makeDb((op: Op) =>
      op.table === "digest_items"
        ? { data: [] }
        : { data: [{ youtube_video_id: "s1" }, { youtube_video_id: "s2" }] },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/youtube/v3/videos")) {
          return {
            ok: true,
            json: async () => ({
              items: [
                { id: "s1", snippet: { channelId: "UCgone", channelTitle: "Gone" } },
                { id: "s2", snippet: { channelId: "UCok", channelTitle: "Chan" } },
              ],
            }),
          };
        }
        if (url.includes("UCgone")) return { ok: false, status: 404 };
        return {
          ok: true,
          text: async () => feed(entry("new", "https://www.youtube.com/watch?v=new", daysAgo(1))),
        };
      }),
    );

    expect((await findCandidates("u1", NOW)).map((c) => c.videoId)).toEqual(["new"]);
  });
});
