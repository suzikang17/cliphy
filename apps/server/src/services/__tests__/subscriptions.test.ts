import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Supabase ─────────────────────────────────────────────

function mockChain(result: { data?: unknown; error?: unknown; count?: number | null } = {}) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "in",
    "order",
    "limit",
    "single",
    "maybeSingle",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: ReturnType<typeof mockChain>;

vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "from")
          return (...args: unknown[]) =>
            (supabaseMock.from as (...a: unknown[]) => unknown)(...args);
        return undefined;
      },
    },
  ),
}));

vi.mock("../../lib/inngest.js", () => ({
  inngest: { send: vi.fn() },
}));

const fetchMyPlaylists = vi.fn();
const fetchPlaylistVideos = vi.fn();

vi.mock("../youtube.js", () => ({
  fetchChannelVideos: vi.fn().mockResolvedValue([]),
  fetchLikedVideos: vi.fn().mockResolvedValue([]),
  fetchMyPlaylists: (...a: unknown[]) => fetchMyPlaylists(...a),
  fetchPlaylistVideos: (...a: unknown[]) => fetchPlaylistVideos(...a),
}));

const { discoverCliphyPlaylists } = await import("../subscriptions.js");

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

/** Queue the standard happy-path from() sequence up to the existing-subs check. */
function queuePreamble(opts: {
  settingOff?: boolean;
  plan?: string;
  existing?: string[];
  count?: number;
}) {
  const from = supabaseMock.from as ReturnType<typeof vi.fn>;
  // 1. user_settings
  from.mockReturnValueOnce(
    mockChain({ data: { auto_discover_playlists: !opts.settingOff }, error: null }),
  );
  // 2. users plan
  from.mockReturnValueOnce(mockChain({ data: { plan: opts.plan ?? "pro" }, error: null }));
  // 3. google token (valid, not expiring)
  from.mockReturnValueOnce(
    mockChain({
      data: { access_token: "tok", refresh_token: "r", expires_at: FUTURE },
      error: null,
    }),
  );
  // 4. existing playlist subscriptions
  from.mockReturnValueOnce(
    mockChain({ data: (opts.existing ?? []).map((source_id) => ({ source_id })), error: null }),
  );
  // 5. subscription count
  from.mockReturnValueOnce(mockChain({ data: null, error: null, count: opts.count ?? 0 }));
}

beforeEach(() => {
  supabaseMock = mockChain({ data: null, error: null });
  fetchPlaylistVideos.mockResolvedValue([]);
  vi.clearAllMocks();
});

describe("discoverCliphyPlaylists", () => {
  it("subscribes playlists whose title contains cliphy (case-insensitive)", async () => {
    queuePreamble({});
    fetchMyPlaylists.mockResolvedValue([
      { playlistId: "PLmatch", title: "My CLIPHY queue" },
      { playlistId: "PLother", title: "Workout Mixes" },
    ]);
    const from = supabaseMock.from as ReturnType<typeof vi.fn>;
    // 6. insert for the match
    from.mockReturnValueOnce(mockChain({ data: { id: "sub-new" }, error: null }));
    // 7. seen-videos snapshot insert
    from.mockReturnValueOnce(mockChain({ data: null, error: null }));

    const created = await discoverCliphyPlaylists("user-1");

    expect(created).toBe(1);
    expect(fetchPlaylistVideos).toHaveBeenCalledWith("PLmatch", "tok");
  });

  it("skips playlists that are already subscribed", async () => {
    queuePreamble({ existing: ["PLmatch"] });
    fetchMyPlaylists.mockResolvedValue([{ playlistId: "PLmatch", title: "Cliphy" }]);

    const created = await discoverCliphyPlaylists("user-1");

    expect(created).toBe(0);
  });

  it("does nothing when the setting is off", async () => {
    queuePreamble({ settingOff: true });

    const created = await discoverCliphyPlaylists("user-1");

    expect(created).toBe(0);
    expect(fetchMyPlaylists).not.toHaveBeenCalled();
  });

  it("does nothing for free-plan users", async () => {
    queuePreamble({ plan: "free" });

    const created = await discoverCliphyPlaylists("user-1");

    expect(created).toBe(0);
    expect(fetchMyPlaylists).not.toHaveBeenCalled();
  });

  it("respects the subscription cap", async () => {
    queuePreamble({ count: 20 });
    fetchMyPlaylists.mockResolvedValue([{ playlistId: "PLmatch", title: "Cliphy" }]);

    const created = await discoverCliphyPlaylists("user-1");

    expect(created).toBe(0);
  });
});
