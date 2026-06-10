---
title: "Auto-Subscriptions Implementation Plan"
date: 2026-05-22
---

# Auto-Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build server-side auto-subscriptions for YouTube channels, public playlists, and Watch Later — polling every 15 min via Inngest cron and auto-queuing new videos for summarization.

**Architecture:** Three new Supabase tables (`subscriptions`, `subscription_seen_videos`, `user_google_tokens`) back a CRUD API, a Google OAuth connect flow, and an Inngest fan-out cron. Channels poll via free YouTube RSS feeds; playlists and Watch Later use the YouTube Data API v3 (server API key for public playlists, per-user OAuth token for Watch Later). On each poll, unseen videos are inserted into the queue via the existing `video/summarize.requested` Inngest event.

**Tech Stack:** Hono, Inngest v4, Supabase (service_role), YouTube Data API v3, Google OAuth 2.0, TypeScript, Vitest

---

## File Map

| Action | Path                                                         | Responsibility                                                                                             |
| ------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Create | `apps/server/supabase/migrations/011_auto_subscriptions.sql` | DB schema: 4 new tables + RLS                                                                              |
| Modify | `packages/shared/src/constants.ts`                           | `AUTO_SUBSCRIBE` pro feature, `SUBSCRIPTION_TYPES`, `MAX_SUBSCRIPTIONS_PER_USER`, new `API_ROUTES` entries |
| Modify | `packages/shared/src/types.ts`                               | `SubscriptionType`, `Subscription`, request/response types                                                 |
| Modify | `apps/server/src/lib/mappers.ts`                             | `toSubscription` mapper                                                                                    |
| Create | `apps/server/src/services/youtube.ts`                        | RSS + Data API fetching, URL resolution                                                                    |
| Create | `apps/server/src/services/subscriptions.ts`                  | snapshot seen, poll-and-queue, token refresh                                                               |
| Create | `apps/server/src/routes/subscriptions.ts`                    | CRUD routes (GET/POST/PATCH/DELETE)                                                                        |
| Create | `apps/server/src/routes/auth-google.ts`                      | Google OAuth initiate / callback / disconnect                                                              |
| Create | `apps/server/src/functions/poll-subscriptions.ts`            | Inngest cron + fan-out + process function                                                                  |
| Modify | `apps/server/src/app.ts`                                     | register new routes + functions                                                                            |
| Create | `apps/server/src/services/__tests__/youtube.test.ts`         | unit tests for YouTube service                                                                             |
| Create | `apps/server/src/routes/__tests__/subscriptions.test.ts`     | route tests                                                                                                |
| Create | `apps/server/src/routes/__tests__/auth-google.test.ts`       | OAuth route tests                                                                                          |

---

## Task 1: Database Migration

**Files:**

- Create: `apps/server/supabase/migrations/011_auto_subscriptions.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- apps/server/supabase/migrations/011_auto_subscriptions.sql

-- ── Subscription type enum ─────────────────────────────────────────────────
create type public.subscription_type as enum ('channel', 'playlist', 'watch_later');

-- ── Subscriptions ──────────────────────────────────────────────────────────
create table public.subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  type            public.subscription_type not null,
  source_id       text,
  source_name     text not null,
  source_url      text,
  is_active       boolean not null default true,
  last_checked_at timestamptz,
  skipped_count   integer not null default 0,
  last_skipped_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function extensions.moddatetime(updated_at);

create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_active_idx on public.subscriptions(is_active) where is_active = true;

-- ── Seen videos (deduplication guard) ────────────────────────────────────
create table public.subscription_seen_videos (
  subscription_id  uuid not null references public.subscriptions(id) on delete cascade,
  youtube_video_id text not null,
  seen_at          timestamptz not null default now(),
  primary key (subscription_id, youtube_video_id)
);

create index subscription_seen_videos_sub_idx on public.subscription_seen_videos(subscription_id);

-- ── Google OAuth tokens (for Watch Later) ─────────────────────────────────
create table public.user_google_tokens (
  user_id       uuid primary key references public.users(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  scopes        text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger user_google_tokens_updated_at
  before update on public.user_google_tokens
  for each row execute function extensions.moddatetime(updated_at);

-- ── OAuth state (CSRF prevention, 10-minute TTL) ───────────────────────────
create table public.oauth_states (
  state      text primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

-- ── Row Level Security ─────────────────────────────────────────────────────
alter table public.subscriptions enable row level security;
alter table public.subscription_seen_videos enable row level security;
alter table public.user_google_tokens enable row level security;
alter table public.oauth_states enable row level security;

-- SELECT-only: all writes go through backend (service_role bypasses RLS)
create policy "subscriptions_select_own"
  on public.subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_google_tokens_select_own"
  on public.user_google_tokens for select to authenticated
  using ((select auth.uid()) = user_id);
```

- [ ] **Step 2: Apply the migration in Supabase**

Run in the Supabase SQL editor for your project (ID: `umwtegoeewjmxxlihgtm`), or via:

```bash
# If supabase CLI is linked:
cd apps/server && supabase db push
```

Verify the four tables exist:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('subscriptions','subscription_seen_videos','user_google_tokens','oauth_states');
```

Expected: 4 rows.

- [ ] **Step 3: Commit**

```bash
git add apps/server/supabase/migrations/011_auto_subscriptions.sql
git commit -m "add auto-subscriptions db migration"
```

---

## Task 2: Shared Types & Constants

**Files:**

- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add constants**

In `packages/shared/src/constants.ts`, make these additions:

Add `AUTO_SUBSCRIBE` to the `PRO_FEATURES` object (alongside the existing entries):

```ts
  AUTO_SUBSCRIBE: "auto_subscribe",
```

After the `PRO_FEATURES` block, add:

```ts
export const SUBSCRIPTION_TYPES = {
  CHANNEL: "channel",
  PLAYLIST: "playlist",
  WATCH_LATER: "watch_later",
} as const;

export const MAX_SUBSCRIPTIONS_PER_USER = 20;
```

In the `API_ROUTES` object, add these two entries (alongside existing ones):

```ts
  SUBSCRIPTIONS: {
    LIST: "/api/subscriptions",
    ADD: "/api/subscriptions",
    ITEM: (id: string) => `/api/subscriptions/${id}`,
  },
  AUTH_GOOGLE: {
    CONNECT: "/api/auth/google",
    CALLBACK: "/api/auth/google/callback",
    DISCONNECT: "/api/auth/google",
  },
```

- [ ] **Step 2: Add types**

In `packages/shared/src/types.ts`, append after the existing type definitions:

```ts
export type SubscriptionType = "channel" | "playlist" | "watch_later";

export interface Subscription {
  id: string;
  userId: string;
  type: SubscriptionType;
  sourceId?: string;
  sourceName: string;
  sourceUrl?: string;
  isActive: boolean;
  lastCheckedAt?: string;
  skippedCount: number;
  lastSkippedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionCreateRequest {
  type: SubscriptionType;
  sourceUrl?: string;
}

export interface SubscriptionUpdateRequest {
  isActive?: boolean;
}

export interface GoogleConnectionStatus {
  connected: boolean;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/shared && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/types.ts
git commit -m "add auto-subscription types and constants to shared package"
```

---

## Task 3: YouTube Service

**Files:**

- Create: `apps/server/src/services/youtube.ts`
- Create: `apps/server/src/services/__tests__/youtube.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/server/src/services/__tests__/youtube.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => vi.clearAllMocks());

// Import after stub so the module captures the mock
const { fetchChannelVideos, fetchPlaylistVideos, parseSourceUrl } = await import("../youtube.js");

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
    expect(calledUrl).not.toContain("Authorization");
    expect(videos).toHaveLength(1);
    expect(videos[0].videoId).toBe("vid1");
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
});

describe("parseSourceUrl", () => {
  it("returns watch_later for WL playlist URL", async () => {
    const result = await parseSourceUrl("https://www.youtube.com/playlist?list=WL");
    expect(result.type).toBe("watch_later");
    expect(result.sourceId).toBe("WL");
    expect(result.sourceName).toBe("Watch Later");
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

  it("throws on unsupported URL format", async () => {
    await expect(parseSourceUrl("https://www.youtube.com/watch?v=abc")).rejects.toThrow(
      "Unsupported YouTube URL format",
    );
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd apps/server && pnpm test:unit src/services/__tests__/youtube.test.ts
```

Expected: multiple failures — module not found.

- [ ] **Step 3: Implement the YouTube service**

```ts
// apps/server/src/services/youtube.ts

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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/server && pnpm test:unit src/services/__tests__/youtube.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/youtube.ts apps/server/src/services/__tests__/youtube.test.ts
git commit -m "add YouTube service (RSS + Data API)"
```

---

## Task 4: Subscription Mapper & Service

**Files:**

- Modify: `apps/server/src/lib/mappers.ts`
- Create: `apps/server/src/services/subscriptions.ts`

- [ ] **Step 1: Add `toSubscription` mapper**

In `apps/server/src/lib/mappers.ts`, add this import at the top and the mapper function at the bottom:

```ts
// Add to the import line at top:
import type { Summary, Subscription } from "@cliphy/shared";
```

```ts
// Add after toSummary:
export function toSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as Subscription["type"],
    sourceId: (row.source_id as string) ?? undefined,
    sourceName: row.source_name as string,
    sourceUrl: (row.source_url as string) ?? undefined,
    isActive: row.is_active as boolean,
    lastCheckedAt: (row.last_checked_at as string) ?? undefined,
    skippedCount: (row.skipped_count as number) ?? 0,
    lastSkippedAt: (row.last_skipped_at as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
```

- [ ] **Step 2: Create the subscription service**

```ts
// apps/server/src/services/subscriptions.ts
import { PLAN_LIMITS } from "@cliphy/shared";
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { fetchChannelVideos, fetchPlaylistVideos } from "./youtube.js";

const log = logger.child({ fn: "subscriptions" });

export async function snapshotSeenVideos(
  subscriptionId: string,
  videoIds: string[],
): Promise<void> {
  if (videoIds.length === 0) return;
  await supabase.from("subscription_seen_videos").insert(
    videoIds.map((youtube_video_id) => ({
      subscription_id: subscriptionId,
      youtube_video_id,
    })),
  );
}

export async function refreshGoogleTokenIfNeeded(userId: string): Promise<string | null> {
  const { data: tokenRow } = await supabase
    .from("user_google_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (!tokenRow) return null;

  const expiresAt = new Date(tokenRow.expires_at as string).getTime();
  if (Date.now() < expiresAt - 60_000) return tokenRow.access_token as string;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token as string,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  });

  if (!res.ok) {
    log.warn("Google token refresh failed", { userId, status: res.status });
    return null;
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase
    .from("user_google_tokens")
    .update({ access_token: data.access_token, expires_at: newExpiresAt })
    .eq("user_id", userId);

  return data.access_token;
}

export async function pollAndQueueSubscription(subscriptionId: string): Promise<void> {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("*, users!inner(plan)")
    .eq("id", subscriptionId)
    .single();

  if (!sub || !sub.is_active) return;

  const userId = sub.user_id as string;
  const type = sub.type as string;

  let accessToken: string | null = null;
  if (type === "watch_later") {
    accessToken = await refreshGoogleTokenIfNeeded(userId);
    if (!accessToken) {
      await supabase.from("subscriptions").update({ is_active: false }).eq("id", subscriptionId);
      log.warn("Deactivated watch_later subscription — token refresh failed", { subscriptionId });
      return;
    }
  }

  let videos;
  try {
    if (type === "channel") {
      videos = await fetchChannelVideos(sub.source_id as string);
    } else {
      const playlistId = type === "watch_later" ? "WL" : (sub.source_id as string);
      videos = await fetchPlaylistVideos(playlistId, accessToken ?? undefined);
    }
  } catch (err) {
    log.error("Failed to fetch videos from YouTube", { subscriptionId, err });
    throw err;
  }

  if (videos.length === 0) {
    await supabase
      .from("subscriptions")
      .update({ last_checked_at: new Date().toISOString() })
      .eq("id", subscriptionId);
    return;
  }

  const videoIds = videos.map((v) => v.videoId);
  const { data: seenRows } = await supabase
    .from("subscription_seen_videos")
    .select("youtube_video_id")
    .eq("subscription_id", subscriptionId)
    .in("youtube_video_id", videoIds);

  const seenSet = new Set((seenRows ?? []).map((r) => r.youtube_video_id as string));
  const newVideos = videos.filter((v) => !seenSet.has(v.videoId));

  if (newVideos.length > 0) {
    // Mark all new videos as seen upfront — prevents retry-spam on rate limit
    await supabase.from("subscription_seen_videos").insert(
      newVideos.map((v) => ({
        subscription_id: subscriptionId,
        youtube_video_id: v.videoId,
      })),
    );
  }

  const { data: settingsRow } = await supabase
    .from("user_settings")
    .select("summary_language")
    .eq("user_id", userId)
    .single();
  const summaryLanguage = (settingsRow?.summary_language as string) ?? "en";

  const plan = ((sub as Record<string, unknown>).users as { plan: string } | null)?.plan;
  const limit = PLAN_LIMITS[(plan as "free" | "pro") ?? "free"];
  let skippedThisRun = 0;

  for (const video of newVideos) {
    const { data: allowed } = await supabase.rpc("increment_monthly_count", {
      p_user_id: userId,
      p_limit: limit,
    });

    if (!allowed) {
      skippedThisRun++;
      continue;
    }

    const { data: existing } = await supabase
      .from("summaries")
      .select("id")
      .eq("user_id", userId)
      .eq("youtube_video_id", video.videoId)
      .neq("status", "failed")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabase.rpc("decrement_monthly_count", { p_user_id: userId });
      continue;
    }

    const { data: row, error: insertError } = await supabase
      .from("summaries")
      .insert({
        user_id: userId,
        youtube_video_id: video.videoId,
        video_title: video.title,
        video_channel: video.channelTitle ?? null,
        video_url: `https://www.youtube.com/watch?v=${video.videoId}`,
        summary_language: summaryLanguage,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !row) {
      await supabase.rpc("decrement_monthly_count", { p_user_id: userId });
      continue;
    }

    await inngest.send({
      name: "video/summarize.requested",
      data: {
        summaryId: row.id as string,
        videoId: video.videoId,
        videoTitle: video.title,
      },
    });

    log.info("Auto-queued video", { subscriptionId, videoId: video.videoId, userId });
  }

  const now = new Date().toISOString();
  if (skippedThisRun > 0) {
    await supabase
      .from("subscriptions")
      .update({
        last_checked_at: now,
        skipped_count: (sub.skipped_count as number) + skippedThisRun,
        last_skipped_at: now,
      })
      .eq("id", subscriptionId);
    log.info("Skipped videos due to rate limit", { subscriptionId, skippedThisRun });
  } else {
    await supabase.from("subscriptions").update({ last_checked_at: now }).eq("id", subscriptionId);
  }
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/server && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/lib/mappers.ts apps/server/src/services/subscriptions.ts
git commit -m "add subscription service and toSubscription mapper"
```

---

## Task 5: Subscription CRUD Routes

**Files:**

- Create: `apps/server/src/routes/subscriptions.ts`
- Create: `apps/server/src/routes/__tests__/subscriptions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/server/src/routes/__tests__/subscriptions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

function mockChain(result: { data?: unknown; error?: unknown; count?: number | null } = {}) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "neq",
    "in",
    "is",
    "lt",
    "gte",
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
    "rpc",
    "upsert",
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
        if (prop === "rpc")
          return (...args: unknown[]) =>
            (supabaseMock.rpc as (...a: unknown[]) => unknown)(...args);
        if (prop === "from")
          return (...args: unknown[]) =>
            (supabaseMock.from as (...a: unknown[]) => unknown)(...args);
        return undefined;
      },
    },
  ),
}));

vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn((c: { set: (k: string, v: string) => void }, next: () => unknown) => {
    c.set("userId", "user-123");
    c.set("userEmail", "test@example.com");
    return next();
  }),
}));

vi.mock("../../middleware/require-pro.js", () => ({
  requirePro: vi.fn(() => (_c: unknown, next: () => unknown) => next()),
}));

vi.mock("../../services/youtube.js", () => ({
  parseSourceUrl: vi.fn().mockResolvedValue({
    type: "channel",
    sourceId: "UCtest",
    sourceName: "Test Channel",
    sourceUrl: "https://youtube.com/channel/UCtest",
  }),
  fetchChannelVideos: vi.fn().mockResolvedValue([]),
  fetchPlaylistVideos: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/subscriptions.js", () => ({
  snapshotSeenVideos: vi.fn().mockResolvedValue(undefined),
  refreshGoogleTokenIfNeeded: vi.fn().mockResolvedValue("mock-token"),
}));

const { subscriptionRoutes } = await import("../subscriptions.js");

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route("/subscriptions", subscriptionRoutes);
  return app;
}

beforeEach(() => {
  supabaseMock = mockChain({ data: [], error: null });
  vi.clearAllMocks();
});

describe("GET /subscriptions", () => {
  it("returns list of subscriptions", async () => {
    supabaseMock = mockChain({
      data: [
        {
          id: "sub-1",
          user_id: "user-123",
          type: "channel",
          source_id: "UCtest",
          source_name: "Test Channel",
          source_url: "https://youtube.com/channel/UCtest",
          is_active: true,
          last_checked_at: null,
          skipped_count: 0,
          last_skipped_at: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ],
      error: null,
    });

    const app = buildApp();
    const res = await app.request("/subscriptions", { method: "GET" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscriptions: unknown[] };
    expect(body.subscriptions).toHaveLength(1);
  });
});

describe("POST /subscriptions", () => {
  it("creates a channel subscription", async () => {
    const row = {
      id: "sub-new",
      user_id: "user-123",
      type: "channel",
      source_id: "UCtest",
      source_name: "Test Channel",
      source_url: "https://youtube.com/channel/UCtest",
      is_active: true,
      last_checked_at: null,
      skipped_count: 0,
      last_skipped_at: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    supabaseMock = mockChain({ data: row, error: null, count: 0 });

    const app = buildApp();
    const res = await app.request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "channel", sourceUrl: "https://youtube.com/channel/UCtest" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { subscription: { type: string } };
    expect(body.subscription.type).toBe("channel");
  });

  it("returns 400 for missing sourceUrl on non-watch_later type", async () => {
    const app = buildApp();
    const res = await app.request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "channel" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid type", async () => {
    const app = buildApp();
    const res = await app.request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "invalid", sourceUrl: "https://youtube.com/channel/UCtest" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /subscriptions/:id", () => {
  it("updates isActive", async () => {
    const updated = {
      id: "sub-1",
      user_id: "user-123",
      type: "channel",
      source_id: "UCtest",
      source_name: "Test",
      source_url: null,
      is_active: false,
      last_checked_at: null,
      skipped_count: 0,
      last_skipped_at: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };
    supabaseMock = mockChain({ data: updated, error: null });

    const app = buildApp();
    const res = await app.request("/subscriptions/sub-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscription: { isActive: boolean } };
    expect(body.subscription.isActive).toBe(false);
  });
});

describe("DELETE /subscriptions/:id", () => {
  it("deletes subscription", async () => {
    supabaseMock = mockChain({ data: { id: "sub-1" }, error: null });

    const app = buildApp();
    const res = await app.request("/subscriptions/sub-1", { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it("returns 404 when not found", async () => {
    supabaseMock = mockChain({ data: null, error: { code: "PGRST116" } });

    const app = buildApp();
    const res = await app.request("/subscriptions/missing", { method: "DELETE" });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd apps/server && pnpm test:unit src/routes/__tests__/subscriptions.test.ts
```

Expected: failures — module not found.

- [ ] **Step 3: Implement the routes**

```ts
// apps/server/src/routes/subscriptions.ts
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { requirePro } from "../middleware/require-pro.js";
import { supabase } from "../lib/supabase.js";
import { toSubscription } from "../lib/mappers.js";
import { PRO_FEATURES, MAX_SUBSCRIPTIONS_PER_USER } from "@cliphy/shared";
import { parseSourceUrl, fetchChannelVideos, fetchPlaylistVideos } from "../services/youtube.js";
import { snapshotSeenVideos, refreshGoogleTokenIfNeeded } from "../services/subscriptions.js";

export const subscriptionRoutes = new Hono<AppEnv>();

subscriptionRoutes.use("*", authMiddleware);

// GET / — list user's subscriptions
subscriptionRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  const { data: rows, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: "Failed to fetch subscriptions" }, 500);
  return c.json({ subscriptions: (rows ?? []).map(toSubscription) });
});

// POST / — create subscription (Pro-only)
subscriptionRoutes.post("/", requirePro(PRO_FEATURES.AUTO_SUBSCRIBE), async (c) => {
  const userId = c.get("userId");

  let body: { type?: string; sourceUrl?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const validTypes = ["channel", "playlist", "watch_later"];
  if (!body.type || !validTypes.includes(body.type)) {
    return c.json({ error: "type must be channel, playlist, or watch_later" }, 400);
  }

  if (body.type !== "watch_later" && !body.sourceUrl) {
    return c.json({ error: "sourceUrl is required for channel and playlist subscriptions" }, 400);
  }

  // Enforce per-user subscription limit
  const { count } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if ((count ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) {
    return c.json({ error: `Maximum ${MAX_SUBSCRIPTIONS_PER_USER} subscriptions allowed` }, 422);
  }

  // Watch Later requires a connected Google account
  let accessToken: string | null = null;
  if (body.type === "watch_later") {
    const { data: tokenRow } = await supabase
      .from("user_google_tokens")
      .select("user_id")
      .eq("user_id", userId)
      .single();
    if (!tokenRow) {
      return c.json({ error: "Google account not connected", code: "google_not_connected" }, 403);
    }
    accessToken = await refreshGoogleTokenIfNeeded(userId);
    if (!accessToken) {
      return c.json(
        { error: "Google token expired, please reconnect", code: "google_not_connected" },
        403,
      );
    }
  }

  // Resolve URL to source metadata
  let resolved;
  try {
    const urlToResolve =
      body.type === "watch_later" ? "https://www.youtube.com/playlist?list=WL" : body.sourceUrl!;
    resolved = await parseSourceUrl(urlToResolve, accessToken ?? undefined);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Invalid URL" }, 400);
  }

  // Check for duplicate subscription
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("type", resolved.type)
    .eq("source_id", resolved.sourceId ?? "WL")
    .limit(1)
    .maybeSingle();

  if (existing) {
    return c.json({ error: "Already subscribed to this source", code: "DUPLICATE" }, 409);
  }

  // Insert subscription row
  const { data: row, error: insertError } = await supabase
    .from("subscriptions")
    .insert({
      user_id: userId,
      type: resolved.type,
      source_id: resolved.sourceId,
      source_name: resolved.sourceName,
      source_url: resolved.sourceUrl,
      is_active: true,
    })
    .select("*")
    .single();

  if (insertError || !row) {
    return c.json({ error: "Failed to create subscription" }, 500);
  }

  // Snapshot existing videos so first poll only queues new ones
  try {
    let initialVideos;
    if (resolved.type === "channel") {
      initialVideos = await fetchChannelVideos(resolved.sourceId!);
    } else {
      const playlistId = resolved.type === "watch_later" ? "WL" : resolved.sourceId!;
      initialVideos = await fetchPlaylistVideos(playlistId, accessToken ?? undefined);
    }
    await snapshotSeenVideos(
      row.id as string,
      initialVideos.map((v) => v.videoId),
    );
  } catch {
    // Non-fatal: worst case, a few old videos get queued on first poll
  }

  return c.json({ subscription: toSubscription(row) }, 201);
});

// PATCH /:id — pause or resume
subscriptionRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  let body: { isActive?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const update: Record<string, unknown> = {};
  if (typeof body.isActive === "boolean") update.is_active = body.isActive;

  if (Object.keys(update).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  const { data: row, error } = await supabase
    .from("subscriptions")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error || !row) return c.json({ error: "Subscription not found" }, 404);
  return c.json({ subscription: toSubscription(row) });
});

// DELETE /:id
subscriptionRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (!existing) return c.json({ error: "Subscription not found" }, 404);

  await supabase.from("subscriptions").delete().eq("id", id);
  return c.json({ deleted: true });
});
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/server && pnpm test:unit src/routes/__tests__/subscriptions.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/subscriptions.ts apps/server/src/routes/__tests__/subscriptions.test.ts
git commit -m "add subscription CRUD routes"
```

---

## Task 6: Google OAuth Routes

**Files:**

- Create: `apps/server/src/routes/auth-google.ts`
- Create: `apps/server/src/routes/__tests__/auth-google.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/server/src/routes/__tests__/auth-google.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockChain(result: { data?: unknown; error?: unknown } = {}) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "select", "insert", "update", "delete", "eq", "single", "upsert"];
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

vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn((c: { set: (k: string, v: string) => void }, next: () => unknown) => {
    c.set("userId", "user-123");
    c.set("userEmail", "test@example.com");
    return next();
  }),
}));

const { authGoogleRoutes } = await import("../auth-google.js");

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route("/auth/google", authGoogleRoutes);
  return app;
}

beforeEach(() => {
  supabaseMock = mockChain({ data: null, error: null });
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_REDIRECT_URI = "https://api.test.com/api/auth/google/callback";
  process.env.WEB_APP_URL = "https://test.cliphy.app";
});

describe("GET /auth/google", () => {
  it("redirects to Google OAuth URL", async () => {
    supabaseMock = mockChain({ data: null, error: null });

    const app = buildApp();
    const res = await app.request("/auth/google", { method: "GET" });

    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(location).toContain("test-client-id");
    expect(location).toContain("youtube.readonly");
  });
});

describe("GET /auth/google/callback", () => {
  it("redirects to error page if Google returns error param", async () => {
    const app = buildApp();
    const res = await app.request("/auth/google/callback?error=access_denied&state=x");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("google_error=access_denied");
  });

  it("redirects to error page if state is invalid", async () => {
    supabaseMock = mockChain({ data: null, error: { code: "PGRST116" } });

    const app = buildApp();
    const res = await app.request("/auth/google/callback?code=mycode&state=badstate");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("google_error=invalid_state");
  });

  it("stores tokens and redirects to success on valid code + state", async () => {
    // First call: validate state row
    supabaseMock = mockChain({
      data: { user_id: "user-123", expires_at: new Date(Date.now() + 600_000).toISOString() },
      error: null,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "goog-access",
        refresh_token: "goog-refresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/youtube.readonly",
      }),
    });

    const app = buildApp();
    const res = await app.request("/auth/google/callback?code=validcode&state=validstate");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("google_connected=true");
  });
});

describe("DELETE /auth/google", () => {
  it("revokes tokens and disconnects", async () => {
    supabaseMock = mockChain({ data: { access_token: "old-token" }, error: null });
    mockFetch.mockResolvedValueOnce({ ok: true });

    const app = buildApp();
    const res = await app.request("/auth/google", { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { disconnected: boolean };
    expect(body.disconnected).toBe(true);
  });

  it("returns 404 if not connected", async () => {
    supabaseMock = mockChain({ data: null, error: { code: "PGRST116" } });

    const app = buildApp();
    const res = await app.request("/auth/google", { method: "DELETE" });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd apps/server && pnpm test:unit src/routes/__tests__/auth-google.test.ts
```

Expected: failures — module not found.

- [ ] **Step 3: Implement the OAuth routes**

```ts
// apps/server/src/routes/auth-google.ts
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";

const GOOGLE_SCOPES = "https://www.googleapis.com/auth/youtube.readonly";

export const authGoogleRoutes = new Hono<AppEnv>();

// GET /auth/google — initiate OAuth (requires Cliphy auth)
authGoogleRoutes.get("/", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const state = crypto.randomUUID();
  await supabase.from("oauth_states").insert({ state, user_id: userId });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /auth/google/callback — Google redirects here after user approves
authGoogleRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  const webAppUrl = process.env.WEB_APP_URL ?? "https://cliphy.app";

  if (error) {
    return c.redirect(`${webAppUrl}/settings?google_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return c.redirect(`${webAppUrl}/settings?google_error=missing_params`);
  }

  const { data: stateRow } = await supabase
    .from("oauth_states")
    .select("user_id, expires_at")
    .eq("state", state)
    .single();

  if (!stateRow || new Date(stateRow.expires_at as string) < new Date()) {
    return c.redirect(`${webAppUrl}/settings?google_error=invalid_state`);
  }

  const userId = stateRow.user_id as string;
  await supabase.from("oauth_states").delete().eq("state", state);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return c.redirect(`${webAppUrl}/settings?google_error=token_exchange_failed`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  if (!tokens.refresh_token) {
    return c.redirect(`${webAppUrl}/settings?google_error=no_refresh_token`);
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase.from("user_google_tokens").upsert(
    {
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scopes: tokens.scope,
    },
    { onConflict: "user_id" },
  );

  return c.redirect(`${webAppUrl}/settings?google_connected=true`);
});

// DELETE /auth/google — revoke + disconnect
authGoogleRoutes.delete("/", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const { data: tokenRow } = await supabase
    .from("user_google_tokens")
    .select("access_token")
    .eq("user_id", userId)
    .single();

  if (!tokenRow) return c.json({ error: "Google account not connected" }, 404);

  // Best-effort revocation — don't fail if Google returns an error
  await fetch(
    `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(
      tokenRow.access_token as string,
    )}`,
    { method: "POST" },
  ).catch(() => {});

  await supabase.from("user_google_tokens").delete().eq("user_id", userId);

  // Deactivate Watch Later subscriptions that depended on this account
  await supabase
    .from("subscriptions")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("type", "watch_later");

  return c.json({ disconnected: true });
});

// GET /auth/google/status — check whether Google is connected
authGoogleRoutes.get("/status", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const { data } = await supabase
    .from("user_google_tokens")
    .select("user_id")
    .eq("user_id", userId)
    .single();

  return c.json({ connected: !!data });
});
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/server && pnpm test:unit src/routes/__tests__/auth-google.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/auth-google.ts apps/server/src/routes/__tests__/auth-google.test.ts
git commit -m "add Google OAuth connect/disconnect routes"
```

---

## Task 7: Inngest Polling Functions

**Files:**

- Create: `apps/server/src/functions/poll-subscriptions.ts`

- [ ] **Step 1: Create the polling functions**

```ts
// apps/server/src/functions/poll-subscriptions.ts
import { NonRetriableError } from "inngest";
import { inngest } from "../lib/inngest.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { Sentry } from "../lib/sentry.js";
import { pollAndQueueSubscription } from "../services/subscriptions.js";

const log = logger.child({ fn: "poll-subscriptions" });

// Cron: runs every 15 minutes, fans out one event per active subscription
export const pollSubscriptionsCron = inngest.createFunction(
  {
    id: "poll-subscriptions-cron",
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) => {
    const subscriptions = await step.run("fetch-active-subscriptions", async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("is_active", true);
      if (error) throw new Error(`Failed to fetch subscriptions: ${error.message}`);
      return data ?? [];
    });

    if (subscriptions.length === 0) {
      return { fanned_out: 0 };
    }

    await step.run("fan-out", async () => {
      await inngest.send(
        subscriptions.map((s: { id: string }) => ({
          name: "subscription/poll.process" as const,
          data: { subscriptionId: s.id },
        })),
      );
    });

    log.info("Cron fanned out subscription polls", { count: subscriptions.length });
    return { fanned_out: subscriptions.length };
  },
);

// Process a single subscription: poll YouTube, queue new videos
export const processSubscriptionPoll = inngest.createFunction(
  {
    id: "process-subscription-poll",
    retries: 3,
    timeouts: { finish: "2m" },
    triggers: [{ event: "subscription/poll.process" }],
    onFailure: async ({ event }) => {
      const { subscriptionId } = event.data.event.data as { subscriptionId: string };
      const errorMessage = event.data.error.message;
      log.error("Subscription poll permanently failed", { subscriptionId, errorMessage });
      Sentry.captureException(new Error(errorMessage), {
        tags: { component: "inngest", fn: "process-subscription-poll" },
        extra: { subscriptionId },
        fingerprint: ["process-subscription-poll", "failure"],
      });
      await Sentry.flush(2000);
    },
  },
  async ({ event }) => {
    const { subscriptionId } = event.data as { subscriptionId: string };

    try {
      await pollAndQueueSubscription(subscriptionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // YouTube quota errors are non-retryable (quota resets daily, not in minutes)
      if (/quota/i.test(msg)) {
        throw new NonRetriableError(`YouTube quota exceeded: ${msg}`);
      }
      throw err;
    }

    return { subscriptionId, status: "processed" };
  },
);
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/server && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/functions/poll-subscriptions.ts
git commit -m "add Inngest cron and per-subscription poll functions"
```

---

## Task 8: Wire Up app.ts

**Files:**

- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Add imports and register everything**

In `apps/server/src/app.ts`:

Add these imports after the existing function/route imports:

```ts
import { pollSubscriptionsCron, processSubscriptionPoll } from "./functions/poll-subscriptions.js";
import { subscriptionRoutes } from "./routes/subscriptions.js";
import { authGoogleRoutes } from "./routes/auth-google.js";
```

Update the `serve` call to include the new functions:

```ts
app.on(
  ["GET", "PUT", "POST"],
  "/inngest",
  serve({
    client: inngest,
    functions: [summarizeVideo, pollSubscriptionsCron, processSubscriptionPoll],
    serveOrigin: process.env.INNGEST_SERVE_HOST || "https://api.cliphy.app",
    servePath: "/api/inngest",
  }),
);
```

Add the new routes **before** `app.route("/auth", authRoutes)` to ensure `/auth/google` is matched first:

```ts
app.route("/auth/google", authGoogleRoutes); // ← add before authRoutes
app.route("/auth", authRoutes); // ← existing line
// ... rest of routes
app.route("/subscriptions", subscriptionRoutes); // ← add at end
```

- [ ] **Step 2: Verify full TypeScript build**

```bash
cd apps/server && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run all unit tests**

```bash
pnpm test:unit
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/app.ts
git commit -m "wire up subscription routes and Inngest poll functions"
```

---

## Task 9: Set Environment Variables

**Files:** Vercel dashboard / `.env.local`

- [ ] **Step 1: Add env vars to Vercel**

Add these to all three environments (Production, Preview, Development) via `vercel env add` or the Vercel dashboard:

```
YOUTUBE_API_KEY          # YouTube Data API v3 key (from Google Cloud Console)
GOOGLE_CLIENT_ID         # OAuth 2.0 client ID
GOOGLE_CLIENT_SECRET     # OAuth 2.0 client secret
GOOGLE_REDIRECT_URI      # https://api.cliphy.app/api/auth/google/callback
WEB_APP_URL              # https://cliphy.app (for post-OAuth redirect)
```

Use `printf` not `echo` when piping to avoid trailing newlines:

```bash
printf '%s' 'your-youtube-api-key' | vercel env add YOUTUBE_API_KEY production
printf '%s' 'your-youtube-api-key' | vercel env add YOUTUBE_API_KEY preview
printf '%s' 'your-youtube-api-key' | vercel env add YOUTUBE_API_KEY development
```

Repeat for the other four variables.

- [ ] **Step 2: Verify Google Cloud Console config**

In the Google Cloud Console OAuth consent screen, add `https://api.cliphy.app` as an authorized domain and `https://api.cliphy.app/api/auth/google/callback` as an authorized redirect URI.

- [ ] **Step 3: Add to local `.env` for development**

```
YOUTUBE_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback
WEB_APP_URL=http://localhost:5173
```

---

## Task 10: Register Inngest Functions on Dev Server

- [ ] **Step 1: Sync Inngest functions**

After deploying (or in dev with `pnpm dev:server`):

```bash
# In dev: Inngest Dev Server auto-discovers at /api/inngest
# Verify the two new functions appear in the Inngest Dev Server UI:
# - poll-subscriptions-cron (cron: */15 * * * *)
# - process-subscription-poll (event: subscription/poll.process)
```

- [ ] **Step 2: Smoke test the cron manually**

In the Inngest Dev Server UI, click "Run" on `poll-subscriptions-cron`. With no active subscriptions, it should return `{ fanned_out: 0 }` with no errors.

- [ ] **Step 3: End-to-end subscription test**

```
1. Create a Pro user session
2. POST /api/subscriptions  { type: "channel", sourceUrl: "https://www.youtube.com/channel/UCddiUEpeqJcYeBxX1aztDqA" }
   → expect 201, subscription row in DB, seen_videos populated
3. Manually run poll-subscriptions-cron in Inngest
   → expect process-subscription-poll fired for the new subscription
   → expect last_checked_at updated on the subscription row
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "complete auto-subscriptions feature"
```
