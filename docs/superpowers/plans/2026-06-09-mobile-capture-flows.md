---
title: "Mobile Capture Flows Implementation Plan"
date: 2026-06-09
---

# Mobile Capture Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four low-friction ways to queue a video from a phone — liked-videos auto-queue, "Save to Cliphy playlist" capture, a personal-API-key-powered Apple Shortcut, and clipboard onboarding — per `docs/superpowers/specs/2026-06-09-mobile-capture-flows-design.md`.

**Architecture:** Everything server-side extends the existing auto-subscriptions system (`subscriptions` table + Inngest polling + Google OAuth). The Shortcut path adds a parallel auth method (hashed personal API keys) to the existing `authMiddleware`, so all existing routes and limits work unchanged. Client work is additive cards/buttons on the existing subscriptions screens (mobile RN + web React).

**Tech Stack:** Hono, Supabase (Postgres + RLS), Vitest, React Native (Expo) + NativeWind, React (web), `@cliphy/shared` workspace package.

**Conventions that matter here:**

- Server imports use `.js` extensions (ESM).
- Route files mount in `apps/server/src/app.ts` _without_ the `/api` prefix (Vercel routing strips it); clients call `/api/...`.
- Tests: Vitest, route tests mock supabase with the `mockChain` proxy pattern (see `apps/server/src/routes/__tests__/subscriptions.test.ts:7-94`).
- Run tests with `pnpm test:unit` (repo root) or `pnpm vitest run <file>` inside `apps/server`.
- Migrations are plain SQL files in `apps/server/supabase/migrations/`, applied to prod via Supabase MCP `apply_migration`.
- Commit after each task, imperative mood.

---

### Task 1: Shared types — `liked` subscription type

**Files:**

- Modify: `packages/shared/src/types.ts:159` (`SubscriptionType`)
- Modify: `packages/shared/src/constants.ts:50-54` (`SUBSCRIPTION_TYPES`)

- [x] **Step 1: Add the type**

```ts
// types.ts
export type SubscriptionType = "channel" | "playlist" | "watch_later" | "liked";
```

```ts
// constants.ts
export const SUBSCRIPTION_TYPES = {
  CHANNEL: "channel",
  PLAYLIST: "playlist",
  WATCH_LATER: "watch_later",
  LIKED: "liked",
} as const;
```

- [x] **Step 2: Typecheck**

Run: `pnpm --filter @cliphy/shared build` (or `pnpm -r exec tsc --noEmit` if no build script). Expected: clean.

- [x] **Step 3: Commit** — `add liked subscription type to shared types`

---

### Task 2: Migration 016 — `liked` enum value

**Files:**

- Create: `apps/server/supabase/migrations/016_liked_subscriptions.sql`

- [x] **Step 1: Write the migration**

```sql
-- Liked-videos auto-subscription: poll videos.list?myRating=like with user OAuth token
alter type public.subscription_type add value if not exists 'liked';
```

- [x] **Step 2: Apply to prod** via Supabase MCP `apply_migration` (project `umwtegoeewjmxxlihgtm`, name `liked_subscriptions`). Verify: `select unnest(enum_range(null::public.subscription_type));` includes `liked`.

- [x] **Step 3: Commit** — `add liked value to subscription_type enum`

---

### Task 3: `fetchLikedVideos` in the YouTube service

**Files:**

- Modify: `apps/server/src/services/youtube.ts` (append)
- Test: `apps/server/src/services/__tests__/youtube.test.ts` (append)

- [x] **Step 1: Write the failing test**

```ts
describe("fetchLikedVideos", () => {
  it("maps videos.list myRating=like response to previews", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
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
    } as unknown as Response);

    const videos = await fetchLikedVideos("token-abc");
    expect(videos).toEqual([
      {
        videoId: "vid123",
        title: "Liked Video",
        publishedAt: "2026-01-01T00:00:00Z",
        channelTitle: "Some Channel",
      },
    ]);
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("myRating=like");
    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-abc");
  });

  it("throws on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response);
    await expect(fetchLikedVideos("token-abc")).rejects.toThrow("YouTube API error: 403");
  });
});
```

(Import `fetchLikedVideos` alongside the existing imports; follow the existing fetch-mock setup in that file.)

- [x] **Step 2: Run, verify FAIL** — `pnpm vitest run src/services/__tests__/youtube.test.ts` in `apps/server`. Expected: `fetchLikedVideos is not a function`.

- [x] **Step 3: Implement**

```ts
/** Fetch the authenticated user's most recently liked videos (max 50). */
export async function fetchLikedVideos(accessToken: string): Promise<YouTubeVideoPreview[]> {
  const params = new URLSearchParams({
    part: "snippet",
    myRating: "like",
    maxResults: "50",
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet: { title: string; publishedAt: string; channelTitle?: string };
    }>;
  };
  return (data.items ?? []).map((item) => ({
    videoId: item.id,
    title: item.snippet.title,
    publishedAt: item.snippet.publishedAt,
    channelTitle: item.snippet.channelTitle,
  }));
}
```

- [x] **Step 4: Run, verify PASS.**

- [x] **Step 5: Commit** — `add fetchLikedVideos to youtube service`

---

### Task 4: Polling service — `liked` support + OAuth token for playlists

**Files:**

- Modify: `apps/server/src/services/subscriptions.ts:73-90` (token + fetch branches)

- [x] **Step 1: Replace the token/fetch section of `pollAndQueueSubscription`**

Replace lines 73–98 (the `accessToken` block and the `try/catch` fetch block) with:

```ts
// liked and watch_later require a Google token; playlists use one when
// available so private playlists work (falls back to the public API key)
const needsToken = type === "watch_later" || type === "liked";
let accessToken: string | null = null;
if (needsToken || type === "playlist") {
  accessToken = await refreshGoogleTokenIfNeeded(userId);
  if (needsToken && !accessToken) {
    await supabase.from("subscriptions").update({ is_active: false }).eq("id", subscriptionId);
    log.warn("Deactivated subscription — token refresh failed", { subscriptionId, type });
    return;
  }
}

let videos;
try {
  if (type === "channel") {
    videos = await fetchChannelVideos(sub.source_id as string);
  } else if (type === "liked") {
    videos = await fetchLikedVideos(accessToken as string);
  } else {
    const playlistId = type === "watch_later" ? "WL" : (sub.source_id as string);
    videos = await fetchPlaylistVideos(playlistId, accessToken ?? undefined);
  }
} catch (err) {
  log.error(
    "Failed to fetch videos from YouTube",
    err instanceof Error ? err : new Error(String(err)),
    { subscriptionId },
  );
  throw err;
}
```

Update the import at the top: `import { fetchChannelVideos, fetchLikedVideos, fetchPlaylistVideos } from "./youtube.js";`

- [x] **Step 2: Update poll tests if they assert on fetch behavior** — check `apps/server/src/functions/__tests__/poll-subscriptions.test.ts` and `services` tests for mocks of `./youtube.js`; add `fetchLikedVideos: vi.fn().mockResolvedValue([])` to those mock factories so module mocks stay complete.

- [x] **Step 3: Run** `pnpm vitest run` in `apps/server`. Expected: all pass.

- [x] **Step 4: Commit** — `poll liked-videos subscriptions; use OAuth token for playlist polls`

---

### Task 5: POST /subscriptions — accept `liked`

**Files:**

- Modify: `apps/server/src/routes/subscriptions.ts:40-136`
- Test: `apps/server/src/routes/__tests__/subscriptions.test.ts` (append)

- [x] **Step 1: Write the failing tests** (append; the existing file mocks `refreshGoogleTokenIfNeeded` to return `"mock-token"` and exposes `supabaseMock`)

```ts
describe("POST /subscriptions type=liked", () => {
  it("creates a liked subscription when Google is connected", async () => {
    supabaseMock = mockChain({
      data: {
        id: "sub-liked",
        user_id: "user-123",
        type: "liked",
        source_id: "LIKED",
        source_name: "Liked Videos",
        source_url: null,
        is_active: true,
        last_checked_at: null,
        skipped_count: 0,
        last_skipped_at: null,
        created_at: "2026-06-09T00:00:00Z",
        updated_at: "2026-06-09T00:00:00Z",
      },
      error: null,
      count: 0,
    });

    const res = await buildApp().request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "liked" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { subscription: { type: string; sourceName: string } };
    expect(body.subscription.type).toBe("liked");
    expect(body.subscription.sourceName).toBe("Liked Videos");
  });

  it("rejects liked subscription without Google connection", async () => {
    const { refreshGoogleTokenIfNeeded } = await import("../../services/subscriptions.js");
    vi.mocked(refreshGoogleTokenIfNeeded).mockResolvedValueOnce(null);
    // token lookup also returns no row
    supabaseMock = mockChain({ data: null, error: null, count: 0 });

    const res = await buildApp().request("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "liked" }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("google_not_connected");
  });
});
```

Also add `fetchLikedVideos: vi.fn().mockResolvedValue([])` to this file's `vi.mock("../../services/youtube.js", ...)` factory.

Note on the mockChain: `single()`/`maybeSingle()` resolve to the same shared result. The "creates" test relies on the duplicate-check `maybeSingle()` returning `{ data: {...} }` — that would trip the 409 path. To keep the chain simple, the duplicate check in the route must run **before** type-specific Google checks only for URL types; for `liked`/`watch_later` order the queries as in Step 2 and make the dup-check tolerate the shared mock by asserting on `source_id`. If the shared-result ambiguity makes the test flaky, mock `maybeSingle` separately: `(supabaseMock.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: null });` before the request. Pick whichever matches the existing tests' style for the 409 case in this file.

- [x] **Step 2: Run, verify FAIL** (400: `type must be channel, playlist, or watch_later`).

- [x] **Step 3: Implement.** In `routes/subscriptions.ts` POST handler:

```ts
const validTypes = ["channel", "playlist", "watch_later", "liked"];
if (!body.type || !validTypes.includes(body.type)) {
  return c.json({ error: "type must be channel, playlist, watch_later, or liked" }, 400);
}

const isGoogleType = body.type === "watch_later" || body.type === "liked";
if (!isGoogleType && !body.sourceUrl) {
  return c.json({ error: "sourceUrl is required for channel and playlist subscriptions" }, 400);
}
```

Replace the `// Watch Later requires a connected Google account` block's condition with `if (isGoogleType) { ... }` (body unchanged).

Replace the `// Resolve URL to source metadata` block with:

```ts
// Resolve URL to source metadata
let resolved: ResolvedSource;
if (body.type === "liked") {
  resolved = { type: "liked", sourceId: "LIKED", sourceName: "Liked Videos", sourceUrl: null };
} else {
  try {
    const urlToResolve =
      body.type === "watch_later" ? "https://www.youtube.com/playlist?list=WL" : body.sourceUrl!;
    resolved = await parseSourceUrl(urlToResolve, accessToken ?? undefined);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Invalid URL" }, 400);
  }
}
```

Widen `ResolvedSource` in `services/youtube.ts:11` to `type: "channel" | "playlist" | "watch_later" | "liked";` and import the type in the route file. Duplicate-check fallback becomes `resolved.sourceId ?? "WL"` (unchanged — liked always has `sourceId: "LIKED"`).

In the snapshot block, add the liked branch:

```ts
let initialVideos;
if (resolved.type === "channel") {
  initialVideos = await fetchChannelVideos(resolved.sourceId!);
} else if (resolved.type === "liked") {
  initialVideos = await fetchLikedVideos(accessToken!);
} else {
  const playlistId = resolved.type === "watch_later" ? "WL" : resolved.sourceId!;
  initialVideos = await fetchPlaylistVideos(playlistId, accessToken ?? undefined);
}
```

Import `fetchLikedVideos` in the route file.

- [x] **Step 4: Run, verify PASS** (whole server suite).

- [x] **Step 5: Commit** — `accept liked subscriptions in POST /subscriptions`

---

### Task 6: Google disconnect deactivates `liked` too

**Files:**

- Modify: `apps/server/src/routes/auth-google.ts:130-134`
- Test: `apps/server/src/routes/__tests__/auth-google.test.ts` (only if it asserts the deactivation filter)

- [x] **Step 1: Change the deactivation query**

```ts
await supabase
  .from("subscriptions")
  .update({ is_active: false })
  .eq("user_id", userId)
  .in("type", ["watch_later", "liked"]);
```

- [x] **Step 2: Run server tests; fix any assertion on `.eq("type", "watch_later")`.**

- [x] **Step 3: Commit** — `deactivate liked subscriptions on google disconnect`

---

### Task 7: Mobile UI — Liked Videos enable + labels

**Files:**

- Modify: `apps/mobile/app/(tabs)/subscriptions.tsx`

- [x] **Step 1: Labels and badges.** Add to `TYPE_LABELS` (line 49) `liked: "Liked Videos"`; in `SubscriptionRow`, add to `typeBadgeColors` `liked: "bg-pink-100 dark:bg-pink-900/30"` and to `typeBadgeText` `liked: "text-pink-700 dark:text-pink-300"`.

- [x] **Step 2: Enable button.** In `SubscriptionsScreen`, alongside `hasWatchLater` add `const hasLiked = subscriptions.some((s) => s.type === "liked");` and a handler mirroring `handleAddWatchLater`:

```tsx
async function handleAddLiked() {
  setAddLoading(true);
  try {
    const res = await createSubscription({ type: "liked" });
    setSubscriptions((prev) => [...prev, res.subscription]);
  } catch (err) {
    Alert.alert("Error", err instanceof Error ? err.message : "Failed to add Liked Videos");
  } finally {
    setAddLoading(false);
  }
}
```

Rename the "Watch Later" card heading to "Google Account" with subtitle "Connect Google to auto-queue videos you like (and Watch Later)." In the `googleConnected` branch, add an "Auto-queue Liked Videos" `Pressable` (same styles as the Enable button) shown when `!hasLiked && isPro`, calling `handleAddLiked`. Update `handleDisconnectGoogle`'s filter to `prev.filter((s) => s.type !== "watch_later" && s.type !== "liked")` and its Alert copy to "This will also remove your Liked Videos and Watch Later subscriptions."

- [x] **Step 3: Verify** — `pnpm lint` and a TypeScript check pass; eyeball in Expo if a dev build is running.

- [x] **Step 4: Commit** — `mobile: liked-videos subscription UI`

---

### Task 8: Web UI — Liked Videos enable + labels

**Files:**

- Modify: `apps/web/src/pages/Subscriptions.tsx`

- [x] **Step 1: Mirror Task 7 on web:** add `liked: "Liked Videos"` to the `TYPE_LABELS` map (line ~31) and a badge color entry to the badge map (line ~39, use pink classes consistent with that file's pattern); add `hasLiked`, `handleAddLiked` (mirrors `handleAddWatchLater` at line ~114 using `api.createSubscription({ type: "liked" })`), an enable button in the Google-connected section, and include `liked` in the disconnect filter (line ~159).

- [x] **Step 2: Verify** — `pnpm lint` + `pnpm build:web` pass.

- [x] **Step 3: Commit** — `web: liked-videos subscription UI`

---

### Task 9: Migration 017 — `api_keys` table

**Files:**

- Create: `apps/server/supabase/migrations/017_api_keys.sql`

- [x] **Step 1: Write the migration**

```sql
-- Personal API keys (for the "Add to Cliphy" Apple Shortcut and other clients)
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  key_hash     text not null unique,   -- sha256 hex of the full plaintext key
  key_prefix   text not null,          -- first 14 chars, for display only
  name         text not null default 'Shortcut',
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

create index api_keys_user_id_idx on public.api_keys(user_id);

alter table public.api_keys enable row level security;

-- SELECT-only: all writes go through backend (service_role bypasses RLS)
create policy "api_keys_select_own"
  on public.api_keys for select to authenticated
  using ((select auth.uid()) = user_id);
```

- [x] **Step 2: Apply to prod** via Supabase MCP `apply_migration` (name `api_keys`). Verify with `select * from api_keys limit 1;`.

- [x] **Step 3: Commit** — `add api_keys table`

---

### Task 10: API-key auth in `authMiddleware`

**Files:**

- Modify: `apps/server/src/middleware/auth.ts`
- Modify: `apps/server/src/env.ts` (add `authMethod` to context vars)
- Test: Create `apps/server/src/middleware/__tests__/auth.test.ts`

- [x] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createHash } from "crypto";
import type { AppEnv } from "../../env.js";

const PLAINTEXT = "cliphy_sk_testkey1234567890abcdef";
const HASH = createHash("sha256").update(PLAINTEXT).digest("hex");

const maybeSingle = vi.fn();
const getUser = vi.fn();

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    auth: { getUser: (...a: unknown[]) => getUser(...a) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: (...a: unknown[]) => maybeSingle(...a),
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    })),
  },
}));

const { authMiddleware } = await import("../auth.js");

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("*", authMiddleware);
  app.get("/whoami", (c) => c.json({ userId: c.get("userId"), method: c.get("authMethod") }));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authMiddleware api keys", () => {
  it("authenticates a valid cliphy_sk_ key", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "key-1", user_id: "user-9" }, error: null });
    const res = await buildApp().request("/whoami", {
      headers: { Authorization: `Bearer ${PLAINTEXT}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-9", method: "api_key" });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects an unknown cliphy_sk_ key", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await buildApp().request("/whoami", {
      headers: { Authorization: "Bearer cliphy_sk_wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("falls through to supabase JWT for non-prefixed tokens", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "a@b.c" } }, error: null });
    const res = await buildApp().request("/whoami", {
      headers: { Authorization: "Bearer some.jwt.token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1", method: "jwt" });
  });
});
```

(The middleware must look up by `key_hash` = sha256 of the presented token — assert via `HASH` if you want a stricter test.)

- [x] **Step 2: Run, verify FAIL.**

- [x] **Step 3: Implement.** `env.ts`: add `authMethod: "jwt" | "api_key";` to the context `Variables`. `auth.ts`:

```ts
import { createHash } from "crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.js";
import { supabase } from "../lib/supabase.js";

const API_KEY_PREFIX = "cliphy_sk_";

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);

  if (token.startsWith(API_KEY_PREFIX)) {
    const keyHash = createHash("sha256").update(token).digest("hex");
    const { data: keyRow } = await supabase
      .from("api_keys")
      .select("id, user_id")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (!keyRow) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Fire and forget — last-used tracking shouldn't block the request
    void supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyRow.id)
      .then(
        () => {},
        () => {},
      );

    c.set("userId", keyRow.user_id as string);
    c.set("userEmail", "");
    c.set("authMethod", "api_key");
    return next();
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("userId", user.id);
  c.set("userEmail", user.email ?? "");
  c.set("authMethod", "jwt");

  await next();
};
```

- [x] **Step 4: Run, verify PASS** (full server suite — existing route tests mock this middleware, so they're unaffected; if any set only `userId`/`userEmail`, they don't read `authMethod` and still pass).

- [x] **Step 5: Commit** — `support personal api keys in auth middleware`

---

### Task 11: API-key routes

**Files:**

- Create: `apps/server/src/routes/api-keys.ts`
- Modify: `apps/server/src/app.ts` (import + `app.route("/keys", apiKeyRoutes);`)
- Modify: `packages/shared/src/types.ts` (ApiKey types), `packages/shared/src/constants.ts` (`API_ROUTES.KEYS`, `MAX_API_KEYS_PER_USER`)
- Test: Create `apps/server/src/routes/__tests__/api-keys.test.ts`

- [x] **Step 1: Shared types**

```ts
// types.ts
export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface ApiKeyCreateResponse {
  apiKey: ApiKey;
  /** Full plaintext key — shown once, never retrievable again. */
  key: string;
}
```

```ts
// constants.ts
export const MAX_API_KEYS_PER_USER = 5;
// in API_ROUTES:
  KEYS: {
    LIST: "/api/keys",
    CREATE: "/api/keys",
    ITEM: (id: string) => `/api/keys/${id}`,
  },
```

- [x] **Step 2: Write the failing tests** (same mockChain pattern as `subscriptions.test.ts`; mock `authMiddleware` to set `userId`, `userEmail`, **and** `authMethod: "jwt"`)

```ts
describe("POST /keys", () => {
  it("creates a key and returns plaintext once", async () => {
    supabaseMock = mockChain({
      data: {
        id: "key-1",
        user_id: "user-123",
        key_prefix: "cliphy_sk_abc",
        name: "Shortcut",
        last_used_at: null,
        created_at: "2026-06-09T00:00:00Z",
      },
      error: null,
      count: 0,
    });
    const res = await buildApp().request("/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Shortcut" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { key: string; apiKey: { keyPrefix: string } };
    expect(body.key.startsWith("cliphy_sk_")).toBe(true);
    expect(body.key.length).toBeGreaterThan(30);
  });

  it("enforces the per-user key cap", async () => {
    supabaseMock = mockChain({ data: null, error: null, count: 5 });
    const res = await buildApp().request("/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it("rejects api-key-authenticated callers", async () => {
    // buildApp variant where the mocked authMiddleware sets authMethod: "api_key"
    const res = await buildAppWithApiKeyAuth().request("/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /keys/:id", () => {
  it("deletes own key", async () => {
    supabaseMock = mockChain({ data: { id: "key-1" }, error: null });
    const res = await buildApp().request("/keys/key-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
  });
});
```

For `buildAppWithApiKeyAuth`, mock the middleware module with a settable variable: `let mockAuthMethod = "jwt";` and in the mock set `c.set("authMethod", mockAuthMethod)`; flip it in the test and restore in `beforeEach`.

- [x] **Step 3: Run, verify FAIL.**

- [x] **Step 4: Implement `routes/api-keys.ts`**

```ts
import { Hono } from "hono";
import { createHash, randomBytes } from "crypto";
import { MAX_API_KEYS_PER_USER } from "@cliphy/shared";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";

export const apiKeyRoutes = new Hono<AppEnv>();

apiKeyRoutes.use("*", authMiddleware);

// API keys can't manage API keys — JWT sessions only
apiKeyRoutes.use("*", async (c, next) => {
  if (c.get("authMethod") === "api_key") {
    return c.json({ error: "API keys cannot manage API keys" }, 403);
  }
  await next();
});

function toApiKey(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    name: row.name as string,
    keyPrefix: row.key_prefix as string,
    lastUsedAt: (row.last_used_at as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}

// GET / — list keys (prefix only, never the key)
apiKeyRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { data: rows, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, last_used_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: "Failed to fetch API keys" }, 500);
  return c.json({ apiKeys: (rows ?? []).map(toApiKey) });
});

// POST / — create key; plaintext returned once
apiKeyRoutes.post("/", async (c) => {
  const userId = c.get("userId");

  let body: { name?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // empty body is fine
  }

  const { count } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if ((count ?? 0) >= MAX_API_KEYS_PER_USER) {
    return c.json({ error: `Maximum ${MAX_API_KEYS_PER_USER} API keys allowed` }, 422);
  }

  const key = `cliphy_sk_${randomBytes(24).toString("base64url")}`;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const keyPrefix = key.slice(0, 14);

  const { data: row, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: userId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name: body.name?.trim() || "Shortcut",
    })
    .select("id, name, key_prefix, last_used_at, created_at")
    .single();

  if (error || !row) return c.json({ error: "Failed to create API key" }, 500);

  return c.json({ apiKey: toApiKey(row), key }, 201);
});

// DELETE /:id — revoke
apiKeyRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const { data: existing } = await supabase
    .from("api_keys")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (!existing) return c.json({ error: "API key not found" }, 404);

  await supabase.from("api_keys").delete().eq("id", id);
  return c.json({ deleted: true });
});
```

Mount in `app.ts` after the other routes: `app.route("/keys", apiKeyRoutes);` with `import { apiKeyRoutes } from "./routes/api-keys.js";`.

- [x] **Step 5: Run, verify PASS.**

- [x] **Step 6: Commit** — `add personal api key routes`

---

### Task 12: Shortcut recipe doc + shared install-link constant

**Files:**

- Create: `docs/shortcuts.md`
- Modify: `packages/shared/src/constants.ts`

- [x] **Step 1: Constant** (empty until the shortcut is published; clients hide the install button when empty)

```ts
/** iCloud install link for the "Add to Cliphy" Apple Shortcut. Empty until published. */
export const SHORTCUT_INSTALL_URL = "";
```

- [x] **Step 2: Write `docs/shortcuts.md`** — the exact recipe to build once in the Shortcuts app:

```markdown
# "Add to Cliphy" Apple Shortcut

Adds a YouTube link to the Cliphy queue from the share sheet, Action Button,
back-tap, or Siri. Works by POSTing to the public API with a personal API key.

## Build recipe (Shortcuts app)

1. New Shortcut → rename "Add to Cliphy".
2. Shortcut settings → enable **Show in Share Sheet**; accepted types: URLs, Text.
3. Add **Import Question**: "Paste your Cliphy API key (Cliphy app → Subscriptions → Shortcut)" → store into a Text action (variable `ApiKey`).
4. Action: **If** Shortcut Input has any value → set variable `VideoUrl` to Shortcut Input. **Otherwise** → **Get Clipboard** → set `VideoUrl` to Clipboard.
5. Action: **Get Contents of URL**
   - URL: `https://api.cliphy.app/api/queue`
   - Method: POST
   - Headers: `Authorization: Bearer <ApiKey>`, `Content-Type: application/json`
   - Request Body (JSON): `{ "videoUrl": <VideoUrl> }`
6. Action: **Get Dictionary from Input** → **If** dictionary has `error` → **Show Notification** "Cliphy: <error>". Otherwise → **Show Notification** "Added to Cliphy ✓".
7. Share → **Copy iCloud Link**, paste it into `SHORTCUT_INSTALL_URL` in
   `packages/shared/src/constants.ts`, and rebuild clients.

## Notes

- The API key is created in the mobile app (Subscriptions tab → Shortcut card)
  or via `POST /api/keys`. Shown once; revocable in the app.
- Free-tier monthly limits apply — the queue route returns a 4xx with a message
  that surfaces in the failure notification.
- Action Button: Settings → Action Button → Shortcut → "Add to Cliphy".
```

- [x] **Step 3: Commit** — `add apple shortcut recipe doc and install-link constant`

---

### Task 13: Mobile — Shortcut setup card + API client

**Files:**

- Modify: `apps/mobile/lib/api.ts` (key endpoints)
- Modify: `apps/mobile/app/(tabs)/subscriptions.tsx` (Shortcut card)

- [x] **Step 1: API client** (append next to the other endpoint helpers)

```ts
// API keys (for the Apple Shortcut)
export const getApiKeys = () => apiFetch<{ apiKeys: ApiKey[] }>("/api/keys");

export const createApiKey = (name?: string) =>
  apiFetch<ApiKeyCreateResponse>("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const deleteApiKey = (id: string) =>
  apiFetch<{ deleted: true }>(`/api/keys/${id}`, { method: "DELETE" });
```

Import `ApiKey, ApiKeyCreateResponse` from `@cliphy/shared`.

- [x] **Step 2: Shortcut card.** Add a card at the bottom of the subscriptions screen (below the list), styled like the existing cards (border-2, `brutalShadowSm()`), with state `const [shortcutKey, setShortcutKey] = useState<string | null>(null);`:

```tsx
{
  /* Apple Shortcut */
}
<View
  className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#f9fafb] dark:bg-[#282828] mt-6"
  style={brutalShadowSm()}
>
  <Text
    className="text-sm font-bold text-[#111827] dark:text-white mb-1"
    style={{ fontFamily: "DMSans" }}
  >
    Add from anywhere (Apple Shortcut)
  </Text>
  <Text
    className="text-xs text-[#6b7280] dark:text-[#9ca3af] mb-3"
    style={{ fontFamily: "DMSans" }}
  >
    Queue videos from the share sheet, Action Button, or Siri — without opening Cliphy. Generate a
    key, then install the shortcut.
  </Text>

  {shortcutKey ? (
    <View>
      <Text
        className="text-xs font-bold text-[#111827] dark:text-white mb-1"
        style={{ fontFamily: "DMSans" }}
      >
        Your key (copied — shown only once):
      </Text>
      <Text
        selectable
        className="text-xs text-[#6b7280] dark:text-[#9ca3af] mb-3"
        style={{ fontFamily: "Menlo" }}
      >
        {shortcutKey}
      </Text>
      {SHORTCUT_INSTALL_URL ? (
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync(SHORTCUT_INSTALL_URL)}
          className="items-center py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-white dark:bg-[#1e1e1e]"
          style={({ pressed }) =>
            pressed ? { transform: [{ translateX: 2 }, { translateY: 2 }] } : brutalShadowSm()
          }
          accessibilityRole="button"
        >
          <Text
            className="font-bold text-sm text-[#111827] dark:text-white"
            style={{ fontFamily: "DMSans" }}
          >
            Install the Shortcut
          </Text>
        </Pressable>
      ) : null}
    </View>
  ) : (
    <Pressable
      onPress={handleCreateShortcutKey}
      disabled={!isPro && false /* available on all plans */}
      className="items-center py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-white dark:bg-[#1e1e1e]"
      style={({ pressed }) =>
        pressed ? { transform: [{ translateX: 2 }, { translateY: 2 }] } : brutalShadowSm()
      }
      accessibilityRole="button"
    >
      <Text
        className="font-bold text-sm text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
      >
        Generate Shortcut key
      </Text>
    </Pressable>
  )}
</View>;
```

Handler + clipboard copy (uses `expo-clipboard`, already a dependency for the clipboard banner — verify; if the helper in `lib/clipboard.ts` uses it, import `* as Clipboard from "expo-clipboard"`):

```tsx
async function handleCreateShortcutKey() {
  try {
    const res = await createApiKey("Shortcut");
    setShortcutKey(res.key);
    await Clipboard.setStringAsync(res.key);
  } catch (err) {
    Alert.alert("Error", err instanceof Error ? err.message : "Failed to create key");
  }
}
```

Import `SHORTCUT_INSTALL_URL` from `@cliphy/shared` and `createApiKey` from `../../lib/api`. Queueing is not Pro-gated, so the button is enabled regardless of plan (remove the dead `disabled` expression above — keep `disabled={false}` out entirely).

- [x] **Step 3: Verify** — lint + tsc pass.

- [x] **Step 4: Commit** — `mobile: shortcut key setup card`

---

### Task 14: Mobile — "Queue from inside YouTube" capture card + clipboard onboarding copy

**Files:**

- Modify: `apps/mobile/app/(tabs)/subscriptions.tsx` (capture card)
- Modify: `apps/mobile/app/(tabs)/index.tsx` (empty-state copy)

- [x] **Step 1: Capture card.** Above the "Add Channel or Playlist" input card, add an instructional card shown when the user has no `playlist` subscription (`const hasPlaylist = subscriptions.some((s) => s.type === "playlist");`):

```tsx
{
  /* Save-to-playlist capture flow */
}
{
  !hasPlaylist && (
    <View
      className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#f9fafb] dark:bg-[#282828] mb-4"
      style={brutalShadowSm()}
    >
      <Text
        className="text-sm font-bold text-[#111827] dark:text-white mb-1"
        style={{ fontFamily: "DMSans" }}
      >
        Queue from inside YouTube
      </Text>
      <Text className="text-xs text-[#6b7280] dark:text-[#9ca3af]" style={{ fontFamily: "DMSans" }}>
        1. In YouTube, create a playlist called "Cliphy" (private is fine if you connect Google
        below){"\n"}
        2. Paste its link in the box below — one time{"\n"}
        3. From then on: Save → Cliphy on any video. It lands in your queue within ~15 minutes.
      </Text>
    </View>
  );
}
```

- [x] **Step 2: Clipboard onboarding copy.** In `apps/mobile/app/(tabs)/index.tsx`, find the queue empty-state text and extend it to teach the clipboard path, e.g. subtitle becomes: `Copy any YouTube link and open Cliphy — we'll offer to queue it. Or paste it here with Add to Queue.` (Match the empty state's existing tone/structure; keep the "Add to Queue" button label untouched — see commit 480c7cd.)

- [x] **Step 3: Verify** — lint + tsc; eyeball in Expo if running.

- [x] **Step 4: Commit** — `mobile: save-to-playlist capture card + clipboard onboarding copy`

---

### Task 15: Verification pass (manual, prod)

**Files:** none (verification + possible follow-up edits)

- [ ] **Step 1: Deploy** server (push to main → Vercel) after all tasks above are merged.
- [ ] **Step 2: Liked videos end-to-end** — in the mobile app (or web): Connect Google → enable Liked Videos → like a new video on YouTube → confirm it appears in the queue within one poll cycle (~15 min). Check Inngest logs for the poll run.
- [ ] **Step 3: Watch Later smoke test (spec workstream 2)** — with the same connected token, run one WL poll (temporarily create a watch_later subscription, or hit the YouTube API directly with the stored token: `GET /youtube/v3/playlistItems?part=snippet&playlistId=WL&maxResults=5` with `Authorization: Bearer <token>`). **If empty** (expected per the 2016 deprecation): remove the Watch Later enable buttons from mobile + web UI and the `watch_later` branch from POST validation (keep enum + polling tolerance), write an ADR `docs/decisions/` ("Remove Watch Later subscriptions — API returns empty since 2016"). **If it works:** leave it, update the 2026-05-22 auto-subscriptions design doc note.
- [ ] **Step 4: Shortcut end-to-end** — build the shortcut from `docs/shortcuts.md`, generate a key in the app, run from share sheet + Action Button; paste the published iCloud link into `SHORTCUT_INSTALL_URL` and rebuild mobile.
- [ ] **Step 5: Playlist capture end-to-end** — create a private "Cliphy" playlist, subscribe (with Google connected), Save a video to it in YouTube, confirm queueing.
- [ ] **Step 6: Docs** — move the roadmap row(s) to `docs/task-archive.md`, devlog entry, ADRs for: liked-videos approach (myRating=like vs LL playlist), API-key auth design (hashed, prefix display, JWT-only management).
