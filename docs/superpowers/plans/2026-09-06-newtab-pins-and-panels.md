---
type: plan
date: 2026-09-06
title: New Tab — Pins & Panels Implementation Plan
---

# New Tab — Pins & Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser new tab with a Cliphy surface — a tile strip of pinned clips and saved views above a masonry feed of what you saved.

**Architecture:** `clips` stays the content store; a new `pinned_items` table is the placement store recording what appears on the new tab and in what order. The mobile masonry math moves to `packages/shared` generalized to N columns; a DOM card layer lands in `packages/shared/src/components` so both the extension new tab and `apps/web` consume it. The new tab paints from a `browser.storage.local` snapshot and revalidates behind it.

**Tech Stack:** Hono + Supabase (Postgres, pgvector) on the server; WXT + React DOM + Tailwind v4 in the extension; Vitest + allure-js-commons for tests; pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-06-newtab-pins-and-panels-design.md`

## Global Constraints

- TypeScript strict mode. Prettier runs on commit via lint-staged — do not fight its formatting.
- Server files are ESM: **all relative imports carry a `.js` extension** (`import { supabase } from "../lib/supabase.js"`), even from `.ts` sources.
- Extension code uses `browser.*` (WXT auto-polyfills), never `chrome.*`.
- Every test file begins with the allure idiom used repo-wide: `beforeEach` calling `layer("unit")`, `epic(...)`, `feature(...)`.
- Server tests mock Supabase with the local `mockChain` helper pattern (copied per test file — it is not currently shared).
- RLS per ADR 0016: `select`-only policies scoped to `user_id`; all writes go through the service role.
- Commit messages: imperative mood, concise ("add pins route", not "added pins route"). Commit after each task.
- Run unit tests with `pnpm test:unit` from the repo root.
- Migrations run with `pnpm --filter @cliphy/server migrate` (custom runner, ADR 0038 — not the Supabase CLI).
- Next migration number is **027**; 026 is taken by `match_clips`.
- `ClipCategory`, `SourceType`, `Summary` all already exist in `packages/shared/src/types.ts` — extend, never redefine.

---

### Task 1: Migration 027 + shared types

**Files:**

- Create: `apps/server/supabase/migrations/027_pins_and_panels.sql`
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/server/src/lib/mappers.ts:4-32`
- Create: `packages/shared/src/__tests__/pin-types.test.ts`

**Interfaces:**

- Consumes: nothing (first task).
- Produces: `PinnedItem`, `PinKind`, `PinLayout`, `ViewQuery`, `PanelItem`, `EnrichmentTier` types from `@cliphy/shared`; `Summary.enrichmentTier` and `Summary.archivedAt`; `toPinnedItem(row)` in `apps/server/src/lib/mappers.ts`.

- [ ] **Step 1: Write the migration**

Create `apps/server/supabase/migrations/027_pins_and_panels.sql`:

```sql
-- apps/server/supabase/migrations/027_pins_and_panels.sql
-- New tab pins & panels: triage/enrichment facts on clips, plus a placement
-- table recording what appears on the new tab and in what order.

-- Facts about what was done to a clip, and its triage state.
alter table public.clips
  add column if not exists enrichment_tier text not null default 'full'
    check (enrichment_tier in ('metadata','full')),
  add column if not exists archived_at timestamptz;

comment on column public.clips.enrichment_tier is
  'metadata = title/favicon/og:image + embedding, no Claude pass. full = enriched.';

create index if not exists clips_archived_at_idx
  on public.clips (archived_at) where archived_at is null;

-- Placement store. Holds no content — only what is pinned, and where.
create table if not exists public.pinned_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('clip','view')),
  layout     text not null default 'tile' check (layout in ('tile','panel')),
  position   int  not null,
  label      text,
  icon_url   text,
  clip_id    uuid references public.clips(id) on delete cascade,
  view_query jsonb,
  pinned_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pinned_items_target check (
    (kind = 'clip' and clip_id    is not null and view_query is null) or
    (kind = 'view' and view_query is not null and clip_id    is null)
  )
);

create index if not exists pinned_items_user_position_idx
  on public.pinned_items (user_id, position);
create unique index if not exists pinned_items_user_clip_idx
  on public.pinned_items (user_id, clip_id) where clip_id is not null;

-- RLS: select-only for the owner; writes go through the service role.
alter table public.pinned_items enable row level security;

drop policy if exists "pinned_items_select_own" on public.pinned_items;
create policy "pinned_items_select_own"
  on public.pinned_items for select to authenticated
  using (user_id = (select auth.uid()));
```

- [ ] **Step 2: Add the shared types**

Append to `packages/shared/src/types.ts`:

```ts
export type EnrichmentTier = "metadata" | "full";
export type PinKind = "clip" | "view";
export type PinLayout = "tile" | "panel";

/**
 * A saved filter backing a view pin. Deliberately a closed struct — never raw
 * SQL and never an open filter DSL, because this is user-authored JSON that
 * becomes a database query. Unknown keys are ignored by the server.
 */
export interface ViewQuery {
  semantic?: string;
  search?: string;
  tags?: string[];
  sourceType?: SourceType[];
  category?: ClipCategory;
  author?: string;
  limit?: number;
}

export interface PinnedItem {
  id: string;
  userId: string;
  kind: PinKind;
  layout: PinLayout;
  position: number;
  label?: string;
  iconUrl?: string;
  clipId?: string;
  viewQuery?: ViewQuery;
  pinnedAt: string;
  updatedAt: string;
}

/**
 * Normalized shape every panel renders. Clip panels map from `Summary`; the
 * indirection exists so one renderer serves all panel types.
 */
export interface PanelItem {
  id: string;
  title: string;
  subtitle?: string;
  url: string;
  image?: string;
  meta?: string[];
}
```

Then add these two fields to the existing `Summary` interface (around line 95-108), keeping them optional so existing constructors still compile:

```ts
  enrichmentTier?: EnrichmentTier;
  archivedAt?: string;
```

- [ ] **Step 3: Write the failing test**

Create `packages/shared/src/__tests__/pin-types.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { PinnedItem, ViewQuery, PanelItem, Summary } from "../index";

describe("pin types", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Types");
  });

  it("models a clip pin with no view query", () => {
    const pin: PinnedItem = {
      id: "p1",
      userId: "u1",
      kind: "clip",
      layout: "tile",
      position: 0,
      label: "Linear",
      clipId: "c1",
      pinnedAt: "t",
      updatedAt: "t",
    };
    expect(pin.kind).toBe("clip");
    expect(pin.viewQuery).toBeUndefined();
  });

  it("models a view pin carrying a semantic query", () => {
    const viewQuery: ViewQuery = { semantic: "design inspiration", limit: 12 };
    const pin: PinnedItem = {
      id: "p2",
      userId: "u1",
      kind: "view",
      layout: "panel",
      position: 1,
      label: "Design",
      viewQuery,
      pinnedAt: "t",
      updatedAt: "t",
    };
    expect(pin.viewQuery?.semantic).toBe("design inspiration");
    expect(pin.clipId).toBeUndefined();
  });

  it("normalizes a panel item", () => {
    const item: PanelItem = { id: "c1", title: "T", url: "https://x.test" };
    expect(item.title).toBe("T");
  });

  it("allows enrichment tier and archive state on a summary", () => {
    const clip: Summary = {
      id: "c1",
      userId: "u1",
      sourceType: "web",
      status: "completed",
      tags: [],
      createdAt: "t",
      updatedAt: "t",
      enrichmentTier: "metadata",
      archivedAt: undefined,
    } as Summary;
    expect(clip.enrichmentTier).toBe("metadata");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test:unit packages/shared/src/__tests__/pin-types.test.ts`
Expected: FAIL — TypeScript cannot resolve `PinnedItem`, `ViewQuery`, `PanelItem` (they do not exist until Step 2 is saved). If you did Step 2 first, this passes immediately; that is acceptable for a pure type task, but confirm the test file actually type-checks by running it.

- [ ] **Step 5: Extend the row mapper**

In `apps/server/src/lib/mappers.ts`, add two fields inside the object returned by `toClip` (alongside `tags` / `userNotes`):

```ts
    enrichmentTier: (row.enrichment_tier as Summary["enrichmentTier"]) ?? "full",
    archivedAt: (row.archived_at as string) ?? undefined,
```

Then append a new mapper at the end of the file:

```ts
export function toPinnedItem(row: Record<string, unknown>): PinnedItem {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    kind: row.kind as PinnedItem["kind"],
    layout: row.layout as PinnedItem["layout"],
    position: row.position as number,
    label: (row.label as string) ?? undefined,
    iconUrl: (row.icon_url as string) ?? undefined,
    clipId: (row.clip_id as string) ?? undefined,
    viewQuery: (row.view_query as PinnedItem["viewQuery"]) ?? undefined,
    pinnedAt: row.pinned_at as string,
    updatedAt: row.updated_at as string,
  };
}
```

Update the import at the top of the file to `import type { Summary, Subscription, PinnedItem } from "@cliphy/shared";`.

- [ ] **Step 6: Run the tests**

Run: `pnpm test:unit`
Expected: PASS — the new type test passes and no existing test regresses.

- [ ] **Step 7: Apply and verify the migration**

Run: `pnpm --filter @cliphy/server migrate`

Then verify the constraint actually rejects a mixed row. Using the Supabase SQL editor or `psql`:

```sql
-- Expect: ERROR — new row violates check constraint "pinned_items_target"
insert into public.pinned_items (user_id, kind, layout, position, clip_id, view_query)
values ('00000000-0000-0000-0000-000000000000', 'view', 'panel', 0,
        '00000000-0000-0000-0000-000000000000', '{"semantic":"x"}'::jsonb);
```

Record the error output — this is the proof the placement model cannot rot.

- [ ] **Step 8: Commit**

```bash
git add apps/server/supabase/migrations/027_pins_and_panels.sql \
        packages/shared/src/types.ts \
        packages/shared/src/__tests__/pin-types.test.ts \
        apps/server/src/lib/mappers.ts
git commit -m "add pins and panels migration and shared types"
```

---

### Task 2: Move masonry to shared, generalize to N columns

**Files:**

- Create: `packages/shared/src/masonry.ts`
- Create: `packages/shared/src/__tests__/masonry.test.ts`
- Modify: `packages/shared/src/index.ts`
- Delete: `apps/mobile/lib/masonry.ts`
- Delete: `apps/mobile/lib/__tests__/masonry.test.ts`
- Modify: `apps/mobile/components/MasonryFeed.tsx`

**Interfaces:**

- Consumes: `Summary` from Task 1's package.
- Produces: `heightEstimate(clip: Summary): number` and `splitColumns(items: Summary[], columns?: number): Summary[][]` exported from `@cliphy/shared`. **Note the return type change:** it was a fixed `[Summary[], Summary[]]` tuple and is now `Summary[][]`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/masonry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { Summary } from "../types";
import { heightEstimate, splitColumns } from "../masonry";

function clip(p: Partial<Summary>): Summary {
  return {
    id: Math.random().toString(36),
    userId: "u",
    sourceType: "web",
    status: "completed",
    tags: [],
    createdAt: "t",
    updatedAt: "t",
    ...p,
  } as Summary;
}

describe("masonry", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Masonry");
  });

  it("estimates image and tweet-with-media taller than a bare link", () => {
    const link = heightEstimate(clip({ sourceType: "web" }));
    const image = heightEstimate(clip({ sourceType: "image", heroImageUrl: "x" }));
    const tweet = heightEstimate(
      clip({ sourceType: "tweet", sourceMetadata: { media: [{ type: "photo", url: "x" }] } }),
    );
    expect(image).toBeGreaterThan(link);
    expect(tweet).toBeGreaterThan(link);
  });

  it("defaults to two columns, preserving per-column order", () => {
    const tall = clip({ sourceType: "image", heroImageUrl: "x" });
    const s1 = clip({ sourceType: "web" });
    const s2 = clip({ sourceType: "web" });
    const s3 = clip({ sourceType: "web" });
    const cols = splitColumns([tall, s1, s2, s3]);
    expect(cols).toHaveLength(2);
    expect(cols[0][0].id).toBe(tall.id);
    expect(cols[1].map((c) => c.id)).toEqual([s1.id, s2.id, s3.id]);
  });

  it("splits into five columns for a wide surface", () => {
    const items = Array.from({ length: 10 }, () => clip({ sourceType: "web" }));
    const cols = splitColumns(items, 5);
    expect(cols).toHaveLength(5);
    expect(cols.flat()).toHaveLength(10);
    for (const col of cols) expect(col).toHaveLength(2);
  });

  it("returns the requested number of columns even when empty", () => {
    const cols = splitColumns([], 4);
    expect(cols).toHaveLength(4);
    expect(cols.flat()).toHaveLength(0);
  });

  it("puts a single item in the first column", () => {
    const only = clip({ sourceType: "web" });
    const cols = splitColumns([only], 3);
    expect(cols[0].map((c) => c.id)).toEqual([only.id]);
    expect(cols[1]).toHaveLength(0);
    expect(cols[2]).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit packages/shared/src/__tests__/masonry.test.ts`
Expected: FAIL — `Cannot find module '../masonry'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/masonry.ts`:

```ts
import type { Summary } from "./types";

// Rough relative card heights used only to balance columns. Units are
// arbitrary "estimated points"; only the ratios matter.
export function heightEstimate(clip: Summary): number {
  const base = 90; // frame + title + meta
  const meta = (clip.sourceMetadata ?? {}) as { media?: unknown[]; kind?: string };
  switch (clip.sourceType) {
    case "image":
      return base + (clip.heroImageUrl ? 220 : 40);
    case "tweet":
      return base + (Array.isArray(meta.media) && meta.media.length ? 200 : 40);
    case "web":
      return base + (clip.heroImageUrl ? 150 : 0) + (clip.excerpt ? 30 : 0);
    case "youtube":
      return base + 80; // thumbnail
    case "podcast":
      return base + (clip.excerpt ? 30 : 0);
    default:
      return base;
  }
}

/**
 * Greedy shortest-column bin-packing. Each item joins whichever column
 * currently has the smallest running estimated height, preserving feed order
 * within a column. Two columns suits a phone; a wide new tab passes 4-5.
 */
export function splitColumns(items: Summary[], columns = 2): Summary[][] {
  const count = Math.max(1, Math.floor(columns));
  const cols: Summary[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);
  for (const item of items) {
    let target = 0;
    for (let i = 1; i < count; i++) {
      if (heights[i] < heights[target]) target = i;
    }
    cols[target].push(item);
    heights[target] += heightEstimate(item);
  }
  return cols;
}
```

Add to `packages/shared/src/index.ts`, after the `./utils` line:

```ts
export * from "./masonry";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit packages/shared/src/__tests__/masonry.test.ts`
Expected: PASS — all five cases.

- [ ] **Step 5: Repoint mobile and delete the old copy**

In `apps/mobile/components/MasonryFeed.tsx`, change the masonry import from the local module to the shared package:

```ts
import { splitColumns } from "@cliphy/shared";
```

`MasonryFeed` destructures the result. Because the return type is now `Summary[][]` rather than a 2-tuple, replace the destructuring with indexed access:

```ts
const cols = splitColumns(items, 2);
const colA = cols[0];
const colB = cols[1];
```

Then delete the superseded files:

```bash
rm apps/mobile/lib/masonry.ts apps/mobile/lib/__tests__/masonry.test.ts
```

- [ ] **Step 6: Verify nothing regressed**

Run: `pnpm test:unit && pnpm lint`
Expected: PASS. If `lint` reports an unused import in `MasonryFeed.tsx`, remove it. Confirm no file still imports `lib/masonry`:

Run: `grep -rn "lib/masonry" apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/masonry.ts \
        packages/shared/src/__tests__/masonry.test.ts \
        packages/shared/src/index.ts \
        apps/mobile/components/MasonryFeed.tsx
git add -u apps/mobile/lib
git commit -m "move masonry layout to shared and generalize to n columns"
```

---

### Task 3: Archive endpoints and inbox filtering

**Files:**

- Modify: `apps/server/src/routes/summaries.ts`
- Modify: `packages/shared/src/constants.ts:99-110`
- Create: `apps/server/src/routes/__tests__/archive.test.ts`

**Interfaces:**

- Consumes: `Summary.archivedAt`, `Summary.enrichmentTier` from Task 1.
- Produces: `POST /api/summaries/:id/archive`, `POST /api/summaries/:id/unarchive`; `API_ROUTES.SUMMARIES.ARCHIVE(id)` and `.UNARCHIVE(id)`; the inbox list filters `archived_at is null` and `enrichment_tier = 'full'`.

- [ ] **Step 1: Add the route constants**

In `packages/shared/src/constants.ts`, inside the `SUMMARIES` block, add:

```ts
    ARCHIVE: (id: string) => `/api/summaries/${id}/archive`,
    UNARCHIVE: (id: string) => `/api/summaries/${id}/unarchive`,
```

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/routes/__tests__/archive.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

function mockChain(result: Record<string, unknown> = {}) {
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
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_: unknown, p: string) =>
        p === "from"
          ? (...a: unknown[]) => (supabaseMock.from as (...args: unknown[]) => unknown)(...a)
          : undefined,
    },
  ),
}));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      await next();
    },
  ),
}));

const { summaryRoutes } = await import("../summaries.js");

function app() {
  return new Hono().route("/api/summaries", summaryRoutes);
}

describe("archive routes", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Archive");
    vi.clearAllMocks();
  });

  it("archives a clip by stamping archived_at", async () => {
    const chain = mockChain({
      data: { id: "c1", archived_at: "2026-09-06T00:00:00Z" },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/summaries/c1/archive", { method: "POST" });

    expect(res.status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(String) }),
    );
  });

  it("unarchives a clip by nulling archived_at", async () => {
    const chain = mockChain({ data: { id: "c1", archived_at: null }, error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/summaries/c1/unarchive", { method: "POST" });

    expect(res.status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith({ archived_at: null });
  });

  it("returns 500 when the update fails", async () => {
    const chain = mockChain({ data: null, error: { message: "boom" } });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/summaries/c1/archive", { method: "POST" });

    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:unit apps/server/src/routes/__tests__/archive.test.ts`
Expected: FAIL — both archive requests return 404 because the routes do not exist.

- [ ] **Step 4: Implement the routes**

In `apps/server/src/routes/summaries.ts`, add these two routes. Place them **before** any `/:id` catch-all route, matching the existing comment convention used for `/search`:

```ts
// ── POST /:id/archive — move a clip out of the inbox ──────────
summaryRoutes.post("/:id/archive", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { data, error } = await supabase
    .from("clips")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, archived_at")
    .single();
  if (error || !data) return c.json({ error: "Failed to archive clip" }, 500);
  return c.json({ id: data.id, archivedAt: data.archived_at });
});

// ── POST /:id/unarchive — undo an archive ─────────────────────
summaryRoutes.post("/:id/unarchive", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { data, error } = await supabase
    .from("clips")
    .update({ archived_at: null })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, archived_at")
    .single();
  if (error || !data) return c.json({ error: "Failed to unarchive clip" }, 500);
  return c.json({ id: data.id, archivedAt: null });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:unit apps/server/src/routes/__tests__/archive.test.ts`
Expected: PASS — all three cases.

- [ ] **Step 6: Filter the inbox list**

Find the `GET /` handler in `apps/server/src/routes/summaries.ts` (the inbox list). Add two filters to its Supabase query chain, immediately after the existing `.is("deleted_at", null)`:

```ts
    .is("archived_at", null)
    .eq("enrichment_tier", "full")
```

Add this comment directly above them, because it is the spec's deliberately-deferred decision and a future reader must not "clean it up":

```ts
// Metadata-tier clips are bookmarks (tiles), not things to triage. Deleting
// the enrichment_tier filter below is the one-line way to change that
// decision — see the pins & panels spec, "Why these shapes".
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm test:unit`
Expected: PASS. If an existing `summaries.test.ts` case asserts an exact chain-call count on the list handler, update that expectation to include the two new calls.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/routes/summaries.ts \
        apps/server/src/routes/__tests__/archive.test.ts \
        packages/shared/src/constants.ts
git commit -m "add archive endpoints and filter inbox by tier and archive state"
```

---

### Task 4: ViewQuery → query builder

**Files:**

- Create: `apps/server/src/services/viewQuery.ts`
- Create: `apps/server/src/services/__tests__/viewQuery.test.ts`

**Interfaces:**

- Consumes: `ViewQuery`, `Summary` from Task 1; `semanticSearch(userId, query, limit)` from `apps/server/src/services/search.js`.
- Produces: `sanitizeViewQuery(input: unknown): ViewQuery` and `runViewQuery(userId: string, view: ViewQuery): Promise<Summary[]>` from `apps/server/src/services/viewQuery.js`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/services/__tests__/viewQuery.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

function mockChain(result: Record<string, unknown> = {}) {
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
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
    "contains",
    "overlaps",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_: unknown, p: string) =>
        p === "from"
          ? (...a: unknown[]) => (supabaseMock.from as (...args: unknown[]) => unknown)(...a)
          : undefined,
    },
  ),
}));
const semanticSearch = vi.fn(async () => []);
vi.mock("../search.js", () => ({ semanticSearch: (...a: unknown[]) => semanticSearch(...a) }));
vi.mock("../../lib/storage.js", () => ({
  resolveClipImage: vi.fn(async (c: unknown) => c),
}));

const { sanitizeViewQuery, runViewQuery } = await import("../viewQuery.js");

describe("viewQuery", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Views");
    vi.clearAllMocks();
    supabaseMock = { from: vi.fn().mockReturnValue(mockChain({ data: [], error: null })) };
  });

  it("drops unknown keys", () => {
    const clean = sanitizeViewQuery({ semantic: "x", dropTable: "clips", nope: 1 });
    expect(clean).toEqual({ semantic: "x", limit: 12 });
  });

  it("keeps only known fields with correct types", () => {
    const clean = sanitizeViewQuery({
      tags: ["design", 42],
      sourceType: ["web", "bogus"],
      category: "reading",
      author: "@someone",
      limit: 5,
    });
    expect(clean.tags).toEqual(["design"]);
    expect(clean.sourceType).toEqual(["web"]);
    expect(clean.category).toBe("reading");
    expect(clean.author).toBe("@someone");
    expect(clean.limit).toBe(5);
  });

  it("clamps an absurd limit", () => {
    expect(sanitizeViewQuery({ limit: 9999 }).limit).toBe(50);
    expect(sanitizeViewQuery({ limit: -3 }).limit).toBe(12);
  });

  it("routes a semantic query to semanticSearch", async () => {
    await runViewQuery("u1", { semantic: "design inspiration", limit: 7 });
    expect(semanticSearch).toHaveBeenCalledWith("u1", "design inspiration", 7);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("builds a filter query when there is no semantic term", async () => {
    const chain = mockChain({ data: [], error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    await runViewQuery("u1", { tags: ["design"], sourceType: ["web"], limit: 4 });

    expect(supabaseMock.from).toHaveBeenCalledWith("clips");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(chain.overlaps).toHaveBeenCalledWith("tags", ["design"]);
    expect(chain.in).toHaveBeenCalledWith("source_type", ["web"]);
    expect(chain.limit).toHaveBeenCalledWith(4);
  });

  it("excludes deleted and archived clips from a view", async () => {
    const chain = mockChain({ data: [], error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    await runViewQuery("u1", { tags: ["design"] });

    expect(chain.is).toHaveBeenCalledWith("deleted_at", null);
    expect(chain.is).toHaveBeenCalledWith("archived_at", null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit apps/server/src/services/__tests__/viewQuery.test.ts`
Expected: FAIL — `Cannot find module '../viewQuery.js'`.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/services/viewQuery.ts`:

```ts
import type { Summary, ViewQuery, SourceType, ClipCategory } from "@cliphy/shared";
import { supabase } from "../lib/supabase.js";
import { toClip } from "../lib/mappers.js";
import { resolveClipImage } from "../lib/storage.js";
import { semanticSearch } from "./search.js";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

const SOURCE_TYPES: SourceType[] = ["youtube", "tweet", "podcast", "web", "image"];

/**
 * Coerce user-authored JSON into a ViewQuery. This is the security boundary:
 * view_query comes from the client and becomes a database query, so only known
 * fields with the right types survive. Everything else is dropped silently.
 */
export function sanitizeViewQuery(input: unknown): ViewQuery {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: ViewQuery = {};

  if (typeof raw.semantic === "string" && raw.semantic.trim()) out.semantic = raw.semantic.trim();
  if (typeof raw.search === "string" && raw.search.trim()) out.search = raw.search.trim();
  if (typeof raw.author === "string" && raw.author.trim()) out.author = raw.author.trim();
  if (typeof raw.category === "string") out.category = raw.category as ClipCategory;

  if (Array.isArray(raw.tags)) {
    const tags = raw.tags.filter((t): t is string => typeof t === "string" && t.length > 0);
    if (tags.length) out.tags = tags;
  }

  if (Array.isArray(raw.sourceType)) {
    const types = raw.sourceType.filter(
      (t): t is SourceType => typeof t === "string" && (SOURCE_TYPES as string[]).includes(t),
    );
    if (types.length) out.sourceType = types;
  }

  const limit = typeof raw.limit === "number" && Number.isFinite(raw.limit) ? raw.limit : NaN;
  out.limit =
    Number.isNaN(limit) || limit <= 0 ? DEFAULT_LIMIT : Math.min(Math.floor(limit), MAX_LIMIT);

  return out;
}

/** Run a sanitized view and return the clips it selects, newest first. */
export async function runViewQuery(userId: string, view: ViewQuery): Promise<Summary[]> {
  const limit = view.limit ?? DEFAULT_LIMIT;

  // A semantic term wins: embedding search already ranks and limits.
  if (view.semantic) return semanticSearch(userId, view.semantic, limit);

  let query = supabase
    .from("clips")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .is("archived_at", null);

  if (view.tags?.length) query = query.overlaps("tags", view.tags);
  if (view.sourceType?.length) query = query.in("source_type", view.sourceType);
  if (view.category) query = query.eq("category", view.category);
  if (view.author) query = query.eq("author", view.author);
  if (view.search)
    query = query.or(`video_title.ilike.%${view.search}%,excerpt.ilike.%${view.search}%`);

  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  if (error || !data) return [];

  return Promise.all((data as Record<string, unknown>[]).map((r) => resolveClipImage(toClip(r))));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit apps/server/src/services/__tests__/viewQuery.test.ts`
Expected: PASS — all six cases.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/viewQuery.ts \
        apps/server/src/services/__tests__/viewQuery.test.ts
git commit -m "add view query sanitizer and runner"
```

---

### Task 5: Pins API

**Files:**

- Create: `apps/server/src/routes/pins.ts`
- Create: `apps/server/src/routes/__tests__/pins.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/shared/src/constants.ts:84-115`

**Interfaces:**

- Consumes: `toPinnedItem` (Task 1), `sanitizeViewQuery` / `runViewQuery` (Task 4).
- Produces: `GET /api/pins`, `POST /api/pins`, `PATCH /api/pins/:id`, `DELETE /api/pins/:id`, `POST /api/pins/reorder`, `GET /api/pins/:id/items`; `API_ROUTES.PINS`.

- [ ] **Step 1: Add the route constants**

In `packages/shared/src/constants.ts`, add a `PINS` block inside `API_ROUTES`, after `CLIPS`:

```ts
  PINS: {
    LIST: "/api/pins",
    CREATE: "/api/pins",
    ITEM: (id: string) => `/api/pins/${id}`,
    REORDER: "/api/pins/reorder",
    ITEMS: (id: string) => `/api/pins/${id}/items`,
  },
```

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/routes/__tests__/pins.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

function mockChain(result: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "in",
    "is",
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_: unknown, p: string) =>
        p === "from"
          ? (...a: unknown[]) => (supabaseMock.from as (...args: unknown[]) => unknown)(...a)
          : undefined,
    },
  ),
}));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      await next();
    },
  ),
}));
const runViewQuery = vi.fn(async () => []);
vi.mock("../../services/viewQuery.js", async () => {
  const actual = await vi.importActual<typeof import("../../services/viewQuery.js")>(
    "../../services/viewQuery.js",
  );
  return { sanitizeViewQuery: actual.sanitizeViewQuery, runViewQuery };
});

const { pinsRoutes } = await import("../pins.js");

function app() {
  return new Hono().route("/api/pins", pinsRoutes);
}

function post(path: string, body: unknown) {
  return app().request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("pins routes", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Pins");
    vi.clearAllMocks();
  });

  it("lists pins ordered by position", async () => {
    const chain = mockChain({ data: [], error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/pins");

    expect(res.status).toBe(200);
    expect(chain.order).toHaveBeenCalledWith("position", { ascending: true });
  });

  it("creates a clip pin", async () => {
    const chain = mockChain({
      data: {
        id: "p1",
        user_id: "test-user-id",
        kind: "clip",
        layout: "tile",
        position: 0,
        clip_id: "c1",
        pinned_at: "t",
        updated_at: "t",
      },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await post("/api/pins", { kind: "clip", clipId: "c1", label: "Linear" });

    expect(res.status).toBe(201);
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "clip", clip_id: "c1", label: "Linear" }),
    );
  });

  it("creates a view pin with a sanitized query", async () => {
    const chain = mockChain({
      data: {
        id: "p2",
        user_id: "test-user-id",
        kind: "view",
        layout: "panel",
        position: 1,
        view_query: { semantic: "design", limit: 12 },
        pinned_at: "t",
        updated_at: "t",
      },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await post("/api/pins", {
      kind: "view",
      layout: "panel",
      viewQuery: { semantic: "design", evil: "DROP TABLE" },
    });

    expect(res.status).toBe(201);
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ view_query: { semantic: "design", limit: 12 } }),
    );
  });

  it("rejects a clip pin with no clipId", async () => {
    supabaseMock = { from: vi.fn().mockReturnValue(mockChain({ data: null, error: null })) };
    const res = await post("/api/pins", { kind: "clip" });
    expect(res.status).toBe(400);
  });

  it("rejects a view pin with no viewQuery", async () => {
    supabaseMock = { from: vi.fn().mockReturnValue(mockChain({ data: null, error: null })) };
    const res = await post("/api/pins", { kind: "view" });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown kind", async () => {
    supabaseMock = { from: vi.fn().mockReturnValue(mockChain({ data: null, error: null })) };
    const res = await post("/api/pins", { kind: "connector", connector: "github" });
    expect(res.status).toBe(400);
  });

  it("reorders pins into a dense sequence", async () => {
    const chain = mockChain({ data: [], error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await post("/api/pins/reorder", { ids: ["p3", "p1", "p2"] });

    expect(res.status).toBe(200);
    expect(chain.update).toHaveBeenCalledTimes(3);
    expect(chain.update).toHaveBeenNthCalledWith(1, { position: 0 });
    expect(chain.update).toHaveBeenNthCalledWith(2, { position: 1 });
    expect(chain.update).toHaveBeenNthCalledWith(3, { position: 2 });
  });

  it("resolves items for a view pin", async () => {
    const chain = mockChain({
      data: {
        id: "p2",
        user_id: "test-user-id",
        kind: "view",
        layout: "panel",
        position: 0,
        view_query: { semantic: "design", limit: 12 },
        pinned_at: "t",
        updated_at: "t",
      },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/pins/p2/items");

    expect(res.status).toBe(200);
    expect(runViewQuery).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ semantic: "design" }),
    );
  });

  it("deletes a pin", async () => {
    const chain = mockChain({ data: null, error: null });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/pins/p1", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("user_id", "test-user-id");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:unit apps/server/src/routes/__tests__/pins.test.ts`
Expected: FAIL — `Cannot find module '../pins.js'`.

- [ ] **Step 4: Write the route**

Create `apps/server/src/routes/pins.ts`:

```ts
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { toPinnedItem } from "../lib/mappers.js";
import { sanitizeViewQuery, runViewQuery } from "../services/viewQuery.js";

export const pinsRoutes = new Hono<AppEnv>();

pinsRoutes.use("*", authMiddleware);

// ── GET / — all pins for the user, grid order ────────────────
pinsRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { data, error } = await supabase
    .from("pinned_items")
    .select("*")
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (error) return c.json({ error: "Failed to load pins" }, 500);
  return c.json({ pins: (data ?? []).map((r) => toPinnedItem(r as Record<string, unknown>)) });
});

// ── POST /reorder — rewrite positions into a dense sequence ───
// Registered BEFORE /:id so "reorder" is not captured as an :id param.
pinsRoutes.post("/reorder", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ ids?: string[] }>();
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return c.json({ error: "ids is required" }, 400);
  }
  // ~20 pins per user, so rewriting the list is cheaper than fractional
  // indexing. See the spec's "Why these shapes" before changing this.
  for (const [index, id] of body.ids.entries()) {
    const { error } = await supabase
      .from("pinned_items")
      .update({ position: index })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) return c.json({ error: "Failed to reorder pins" }, 500);
  }
  return c.json({ ok: true });
});

// ── POST / — pin a clip or a view ────────────────────────────
pinsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    kind?: string;
    layout?: string;
    label?: string;
    iconUrl?: string;
    clipId?: string;
    viewQuery?: unknown;
    position?: number;
  }>();

  if (body.kind !== "clip" && body.kind !== "view") {
    return c.json({ error: "kind must be 'clip' or 'view'" }, 400);
  }
  if (body.kind === "clip" && !body.clipId) {
    return c.json({ error: "clipId is required for a clip pin" }, 400);
  }
  if (body.kind === "view" && !body.viewQuery) {
    return c.json({ error: "viewQuery is required for a view pin" }, 400);
  }

  const layout = body.layout === "panel" ? "panel" : "tile";
  const insert: Record<string, unknown> = {
    user_id: userId,
    kind: body.kind,
    layout,
    position: body.position ?? 0,
    label: body.label ?? null,
    icon_url: body.iconUrl ?? null,
    clip_id: body.kind === "clip" ? body.clipId : null,
    view_query: body.kind === "view" ? sanitizeViewQuery(body.viewQuery) : null,
  };

  const { data, error } = await supabase.from("pinned_items").insert(insert).select("*").single();
  if (error || !data) return c.json({ error: "Failed to create pin" }, 500);
  return c.json({ pin: toPinnedItem(data as Record<string, unknown>) }, 201);
});

// ── GET /:id/items — resolve a panel's contents ──────────────
pinsRoutes.get("/:id/items", async (c) => {
  const userId = c.get("userId");
  const { data, error } = await supabase
    .from("pinned_items")
    .select("*")
    .eq("id", c.req.param("id"))
    .eq("user_id", userId)
    .single();
  if (error || !data) return c.json({ error: "Pin not found" }, 404);

  const pin = toPinnedItem(data as Record<string, unknown>);
  if (pin.kind !== "view") return c.json({ error: "Pin is not a view" }, 400);

  const clips = await runViewQuery(userId, sanitizeViewQuery(pin.viewQuery));
  return c.json({ clips });
});

// ── PATCH /:id — rename, re-icon, or switch tile/panel ───────
pinsRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    label?: string;
    iconUrl?: string;
    layout?: string;
    viewQuery?: unknown;
  }>();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.label !== undefined) patch.label = body.label;
  if (body.iconUrl !== undefined) patch.icon_url = body.iconUrl;
  if (body.layout === "tile" || body.layout === "panel") patch.layout = body.layout;
  if (body.viewQuery !== undefined) patch.view_query = sanitizeViewQuery(body.viewQuery);

  const { data, error } = await supabase
    .from("pinned_items")
    .update(patch)
    .eq("id", c.req.param("id"))
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data) return c.json({ error: "Failed to update pin" }, 500);
  return c.json({ pin: toPinnedItem(data as Record<string, unknown>) });
});

// ── DELETE /:id — unpin ──────────────────────────────────────
pinsRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const { error } = await supabase
    .from("pinned_items")
    .delete()
    .eq("id", c.req.param("id"))
    .eq("user_id", userId);
  if (error) return c.json({ error: "Failed to delete pin" }, 500);
  return c.json({ ok: true });
});
```

- [ ] **Step 5: Register the route**

In `apps/server/src/app.ts`, add the import alongside the other route imports:

```ts
import { pinsRoutes } from "./routes/pins.js";
```

Then register it next to the existing `app.route("/clips", clipsRoutes)` line, matching that file's registration style:

```ts
app.route("/pins", pinsRoutes);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test:unit apps/server/src/routes/__tests__/pins.test.ts`
Expected: PASS — all nine cases.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/routes/pins.ts \
        apps/server/src/routes/__tests__/pins.test.ts \
        apps/server/src/app.ts \
        packages/shared/src/constants.ts
git commit -m "add pins api with reorder and view resolution"
```

---

### Task 6: Metadata-tier capture and promotion

**Files:**

- Modify: `apps/server/src/routes/clips.ts:17-70`
- Modify: `apps/server/src/functions/embed-clip.ts`
- Create: `apps/server/src/routes/__tests__/clips-metadata.test.ts`

**Interfaces:**

- Consumes: `Summary.enrichmentTier` (Task 1).
- Produces: `POST /api/clips` accepts `{ url, tier?: "metadata" | "full" }`; `POST /api/summaries/:id/enrich` promotes a metadata clip to full. `embedClip` skips the Claude enrich pass when `enrichment_tier === "metadata"` but **still embeds**.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/routes/__tests__/clips-metadata.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

function mockChain(result: Record<string, unknown> = {}) {
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
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return chain;
}

let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_: unknown, p: string) =>
        p === "from"
          ? (...a: unknown[]) => (supabaseMock.from as (...args: unknown[]) => unknown)(...a)
          : undefined,
    },
  ),
}));
const inngestSend = vi.fn();
vi.mock("../../lib/inngest.js", () => ({
  inngest: { send: (...a: unknown[]) => inngestSend(...a) },
}));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      await next();
    },
  ),
}));
vi.mock("../../services/detectSourceType.js", () => ({ detectSourceType: vi.fn(() => "web") }));
const extractWebMetadata = vi.fn(async () => ({
  title: "Linear",
  siteName: "Linear",
  faviconUrl: "https://linear.app/favicon.ico",
  heroImageUrl: "https://linear.app/og.png",
}));
vi.mock("../../services/extractors/webMetadata.js", () => ({
  extractWebMetadata: (...a: unknown[]) => extractWebMetadata(...a),
}));
vi.mock("../../services/extractors/web.js", () => ({ extractWebClip: vi.fn() }));
vi.mock("../../services/extractors/tweet.js", () => ({ extractTweetClip: vi.fn() }));
vi.mock("../../lib/storage.js", () => ({
  signImageUrl: vi.fn(async () => null),
  resolveClipImage: vi.fn(async (c: unknown) => c),
}));
vi.mock("../../services/related.js", () => ({ findRelatedClips: vi.fn(async () => []) }));

const { clipsRoutes } = await import("../clips.js");

function app() {
  return new Hono().route("/api/clips", clipsRoutes);
}

describe("metadata-tier capture", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Bookmarks");
    vi.clearAllMocks();
  });

  it("saves a metadata clip without running the article extractor", async () => {
    const chain = mockChain({
      data: {
        id: "c1",
        source_type: "web",
        enrichment_tier: "metadata",
        created_at: "t",
        updated_at: "t",
        status: "completed",
        tags: [],
      },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://linear.app", tier: "metadata" }),
    });

    expect(res.status).toBe(201);
    expect(extractWebMetadata).toHaveBeenCalledWith("https://linear.app");
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ enrichment_tier: "metadata", video_title: "Linear" }),
    );
  });

  it("still requests an embedding for a metadata clip", async () => {
    const chain = mockChain({
      data: {
        id: "c1",
        source_type: "web",
        enrichment_tier: "metadata",
        created_at: "t",
        updated_at: "t",
        status: "completed",
        tags: [],
      },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    await app().request("/api/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://linear.app", tier: "metadata" }),
    });

    // Without this, bookmarks are invisible to semantic search.
    expect(inngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: "clip/embed.requested" }),
    );
  });

  it("saves the clip with the url as title when metadata extraction fails", async () => {
    extractWebMetadata.mockRejectedValueOnce(new Error("unreachable"));
    const chain = mockChain({
      data: {
        id: "c1",
        source_type: "web",
        enrichment_tier: "metadata",
        created_at: "t",
        updated_at: "t",
        status: "completed",
        tags: [],
      },
      error: null,
    });
    supabaseMock = { from: vi.fn().mockReturnValue(chain) };

    const res = await app().request("/api/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://linear.app", tier: "metadata" }),
    });

    expect(res.status).toBe(201);
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ video_title: "https://linear.app" }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit apps/server/src/routes/__tests__/clips-metadata.test.ts`
Expected: FAIL — `Cannot find module '../../services/extractors/webMetadata.js'`.

- [ ] **Step 3: Write the metadata extractor**

Create `apps/server/src/services/extractors/webMetadata.ts`:

```ts
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
```

- [ ] **Step 4: Branch the ingest route**

In `apps/server/src/routes/clips.ts`, add the import:

```ts
import { extractWebMetadata } from "../services/extractors/webMetadata.js";
```

Widen the body type on the `POST /` handler:

```ts
const body = await c.req.json<{ url?: string; imagePath?: string; tier?: "metadata" | "full" }>();
```

Then, immediately after the existing dedup check and before the `const insert: Record<string, unknown> = {` block, insert the metadata branch:

```ts
// Bookmark tier: head-only metadata, no Readability, no Claude. Still
// embedded below, or the bookmark would be invisible to semantic search.
if (body.tier === "metadata") {
  let md: Awaited<ReturnType<typeof extractWebMetadata>>;
  try {
    md = await extractWebMetadata(body.url);
  } catch {
    md = { title: body.url };
  }
  const { data: row, error } = await supabase
    .from("clips")
    .insert({
      user_id: userId,
      source_type: sourceType,
      source_url: body.url,
      enrichment_tier: "metadata",
      video_title: md.title,
      hero_image_url: md.heroImageUrl ?? null,
      source_metadata: { siteName: md.siteName, faviconUrl: md.faviconUrl },
      status: "completed",
      tags: [],
    })
    .select("*")
    .single();
  if (error || !row) return c.json({ error: "Failed to save clip" }, 500);
  await inngest.send({ name: "clip/embed.requested", data: { clipId: row.id } });
  return c.json({ clip: toClip(row) }, 201);
}
```

- [ ] **Step 5: Keep the embed worker from enriching metadata clips**

In `apps/server/src/functions/embed-clip.ts`, add `enrichment_tier` to the `ClipRow` type:

```ts
  enrichment_tier?: string;
```

Add it to the `select(...)` string in the `fetch-clip` step (append `, enrichment_tier`).

Then guard the enrichment branch so metadata clips skip Claude but still fall through to the embedding. The condition currently reads exactly:

```ts
    if (
      (clip.source_type === "web" ||
        clip.source_type === "tweet" ||
        clip.source_type === "image") &&
      !clip.summary_json
    ) {
```

Replace it with:

```ts
    // Bookmark-tier clips get an embedding but never a Claude pass — that is
    // the whole point of the metadata tier. Removing this guard silently
    // re-introduces a summarization cost on every pinned site.
    if (
      clip.enrichment_tier !== "metadata" &&
      (clip.source_type === "web" ||
        clip.source_type === "tweet" ||
        clip.source_type === "image") &&
      !clip.summary_json
    ) {
```

- [ ] **Step 6: Add the promotion endpoint**

In `apps/server/src/routes/summaries.ts`, next to the archive routes from Task 3:

```ts
// ── POST /:id/enrich — promote a bookmark to a full clip ──────
summaryRoutes.post("/:id/enrich", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { data, error } = await supabase
    .from("clips")
    .update({ enrichment_tier: "full", status: "pending" })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .single();
  if (error || !data) return c.json({ error: "Failed to enrich clip" }, 500);
  await inngest.send({ name: "clip/embed.requested", data: { clipId: id } });
  return c.json({ ok: true });
});
```

Add the matching constant in `packages/shared/src/constants.ts` under `SUMMARIES`:

```ts
    ENRICH: (id: string) => `/api/summaries/${id}/enrich`,
```

- [ ] **Step 7: Run the tests**

Run: `pnpm test:unit`
Expected: PASS — the three new cases plus every existing test.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/services/extractors/webMetadata.ts \
        apps/server/src/routes/clips.ts \
        apps/server/src/routes/summaries.ts \
        apps/server/src/functions/embed-clip.ts \
        apps/server/src/routes/__tests__/clips-metadata.test.ts \
        packages/shared/src/constants.ts
git commit -m "add metadata-tier capture and enrichment promotion"
```

---

### Task 7: Shared DOM card layer

**Files:**

- Create: `packages/shared/src/components/ClipCard.tsx`
- Create: `packages/shared/src/components/MasonryGrid.tsx`
- Create: `packages/shared/src/panelItem.ts`
- Create: `packages/shared/src/__tests__/panelItem.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Consumes: `splitColumns` (Task 2), `PanelItem` / `Summary` (Task 1).
- Produces: `toPanelItem(clip: Summary): PanelItem`; `<ClipCard item={PanelItem} onOpen={(id) => void} onArchive?={(id) => void} />`; `<MasonryGrid items={Summary[]} columns={number} renderItem={(clip) => ReactNode} />`. All React DOM — `packages/shared/src/components/` is the extension+web shared UI directory (mobile does not import from it).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/panelItem.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { Summary } from "../types";
import { toPanelItem } from "../panelItem";

function clip(p: Partial<Summary>): Summary {
  return {
    id: "c1",
    userId: "u",
    sourceType: "web",
    status: "completed",
    tags: [],
    createdAt: "t",
    updatedAt: "t",
    ...p,
  } as Summary;
}

describe("toPanelItem", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Panels");
  });

  it("uses the video title and source url", () => {
    const item = toPanelItem(clip({ videoTitle: "Some Article", sourceUrl: "https://x.test/a" }));
    expect(item.title).toBe("Some Article");
    expect(item.url).toBe("https://x.test/a");
  });

  it("falls back to the url as title when there is none", () => {
    const item = toPanelItem(clip({ sourceUrl: "https://x.test/a" }));
    expect(item.title).toBe("https://x.test/a");
  });

  it("carries the hero image and excerpt", () => {
    const item = toPanelItem(
      clip({
        videoTitle: "T",
        sourceUrl: "https://x.test",
        heroImageUrl: "https://x.test/og.png",
        excerpt: "E",
      }),
    );
    expect(item.image).toBe("https://x.test/og.png");
    expect(item.subtitle).toBe("E");
  });

  it("prefixes meta with a source glyph", () => {
    expect(toPanelItem(clip({ sourceType: "youtube", videoTitle: "V" })).meta?.[0]).toBe("▶");
    expect(toPanelItem(clip({ sourceType: "tweet", videoTitle: "V" })).meta?.[0]).toBe("🐦");
    expect(toPanelItem(clip({ sourceType: "podcast", videoTitle: "V" })).meta?.[0]).toBe("🎧");
    expect(toPanelItem(clip({ sourceType: "image", videoTitle: "V" })).meta?.[0]).toBe("🖼");
    expect(toPanelItem(clip({ sourceType: "web", videoTitle: "V" })).meta?.[0]).toBe("🔗");
  });

  it("includes the author in meta when present", () => {
    const item = toPanelItem(clip({ videoTitle: "T", author: "Some Channel" }));
    expect(item.meta).toContain("Some Channel");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit packages/shared/src/__tests__/panelItem.test.ts`
Expected: FAIL — `Cannot find module '../panelItem'`.

- [ ] **Step 3: Write the mapper**

Create `packages/shared/src/panelItem.ts`:

```ts
import type { Summary, PanelItem, SourceType } from "./types";

const GLYPH: Record<SourceType, string> = {
  youtube: "▶",
  web: "🔗",
  tweet: "🐦",
  podcast: "🎧",
  image: "🖼",
};

/** Map a clip to the normalized shape every panel renders. */
export function toPanelItem(clip: Summary): PanelItem {
  const url = clip.sourceUrl ?? clip.videoUrl ?? "";
  const meta: string[] = [GLYPH[clip.sourceType] ?? "🔗"];
  if (clip.author) meta.push(clip.author);
  const siteName = (clip.sourceMetadata as { siteName?: string } | undefined)?.siteName;
  if (siteName) meta.push(siteName);

  return {
    id: clip.id,
    title: clip.videoTitle || url || "Untitled",
    subtitle: clip.excerpt ?? clip.summaryJson?.summary,
    url,
    image: clip.heroImageUrl,
    meta,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit packages/shared/src/__tests__/panelItem.test.ts`
Expected: PASS — all five cases.

- [ ] **Step 5: Write the card component**

Create `packages/shared/src/components/ClipCard.tsx`. This ports the mobile card design (spec #4: category kicker, source glyph, content-height hero, neobrutalist frame) to DOM with Tailwind v4 classes:

```tsx
import type { PanelItem } from "../types";

interface ClipCardProps {
  item: PanelItem;
  category?: string;
  expanded?: boolean;
  onToggle?: (id: string) => void;
  onOpen?: (id: string) => void;
  onArchive?: (id: string) => void;
}

export function ClipCard({
  item,
  category,
  expanded = false,
  onToggle,
  onOpen,
  onArchive,
}: ClipCardProps) {
  return (
    <article className="mb-3 border-2 border-black bg-white shadow-[3px_3px_0_0_#000]">
      {item.image && (
        <img
          src={item.image}
          alt=""
          loading="lazy"
          className="block w-full border-b-2 border-black object-cover"
        />
      )}
      <div className="p-3">
        {category && (
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
            {category}
          </p>
        )}
        <button
          type="button"
          onClick={() => onToggle?.(item.id)}
          className="block w-full text-left text-[15px] font-bold leading-snug tracking-[-0.01em]"
        >
          {item.title}
        </button>
        {item.meta && item.meta.length > 0 && (
          <p className="mt-1 text-xs text-neutral-500">{item.meta.join(" · ")}</p>
        )}
        {item.subtitle && (
          <p
            className={
              expanded
                ? "mt-2 text-[13px] text-neutral-600"
                : "mt-2 line-clamp-2 text-[13px] text-neutral-600"
            }
          >
            {item.subtitle}
          </p>
        )}
        {expanded && (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => onOpen?.(item.id)}
              className="border-2 border-black px-2 py-1 text-xs font-bold"
            >
              Open
            </button>
            {onArchive && (
              <button
                type="button"
                onClick={() => onArchive(item.id)}
                className="border-2 border-black px-2 py-1 text-xs font-bold"
              >
                Archive
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 6: Write the grid component**

Create `packages/shared/src/components/MasonryGrid.tsx`:

```tsx
import type { ReactNode } from "react";
import type { Summary } from "../types";
import { splitColumns } from "../masonry";

interface MasonryGridProps {
  items: Summary[];
  columns?: number;
  renderItem: (clip: Summary) => ReactNode;
}

export function MasonryGrid({ items, columns = 4, renderItem }: MasonryGridProps) {
  const cols = splitColumns(items, columns);
  return (
    <div className="flex gap-3">
      {cols.map((col, i) => (
        <div key={i} className="flex-1 min-w-0">
          {col.map((clip) => renderItem(clip))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Export from the package**

Add to `packages/shared/src/index.ts`:

```ts
export * from "./panelItem";
export * from "./components/ClipCard";
export * from "./components/MasonryGrid";
```

- [ ] **Step 8: Run the suite and lint**

Run: `pnpm test:unit && pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/panelItem.ts \
        packages/shared/src/components/ClipCard.tsx \
        packages/shared/src/components/MasonryGrid.tsx \
        packages/shared/src/__tests__/panelItem.test.ts \
        packages/shared/src/index.ts
git commit -m "add shared dom clip card and masonry grid"
```

---

### Task 8: New tab entrypoint with snapshot cache

**Files:**

- Create: `apps/extension/entrypoints/newtab/index.html`
- Create: `apps/extension/entrypoints/newtab/main.tsx`
- Create: `apps/extension/entrypoints/newtab/App.tsx`
- Create: `apps/extension/lib/newtab-cache.ts`
- Create: `apps/extension/lib/__tests__/newtab-cache.test.ts`
- Modify: `apps/extension/wxt.config.ts`
- Modify: `apps/extension/lib/api.ts`

**Interfaces:**

- Consumes: `API_ROUTES.PINS` (Task 5), `PinnedItem` / `Summary` (Task 1).
- Produces: `readSnapshot()` / `writeSnapshot(snapshot)` from `apps/extension/lib/newtab-cache.ts`; `getPins()`, `createPin(body)`, `deletePin(id)`, `reorderPins(ids)`, `getPinItems(id)` in `apps/extension/lib/api.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/extension/lib/__tests__/newtab-cache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const store: Record<string, unknown> = {};
vi.stubGlobal("browser", {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: store[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => Object.assign(store, obj)),
      remove: vi.fn(async (key: string) => {
        delete store[key];
      }),
    },
  },
});

const { readSnapshot, writeSnapshot } = await import("../newtab-cache");

describe("newtab cache", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Snapshot");
    for (const k of Object.keys(store)) delete store[k];
  });

  it("returns null when nothing is cached", async () => {
    expect(await readSnapshot()).toBeNull();
  });

  it("round-trips a snapshot", async () => {
    await writeSnapshot({ pins: [], panels: {}, savedAt: 123 });
    const snap = await readSnapshot();
    expect(snap?.savedAt).toBe(123);
    expect(snap?.pins).toEqual([]);
  });

  it("survives a corrupt cached value", async () => {
    store["newtab:snapshot"] = "not-an-object";
    expect(await readSnapshot()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit apps/extension/lib/__tests__/newtab-cache.test.ts`
Expected: FAIL — `Cannot find module '../newtab-cache'`.

- [ ] **Step 3: Write the cache module**

Create `apps/extension/lib/newtab-cache.ts`:

```ts
import type { PinnedItem, Summary } from "@cliphy/shared";
import { get, set } from "./storage";

const KEY = "newtab:snapshot";

export interface NewTabSnapshot {
  pins: PinnedItem[];
  /** Panel id → the clips it last resolved to. "inbox" is the default panel. */
  panels: Record<string, Summary[]>;
  savedAt: number;
}

/**
 * The new tab must paint before the user perceives it, so the page renders
 * from this snapshot first and revalidates behind it. A corrupt or missing
 * value is not an error — it just means a cold start.
 */
export async function readSnapshot(): Promise<NewTabSnapshot | null> {
  const raw = await get<unknown>(KEY);
  if (!raw || typeof raw !== "object") return null;
  const snap = raw as Partial<NewTabSnapshot>;
  if (!Array.isArray(snap.pins) || typeof snap.panels !== "object" || !snap.panels) return null;
  return { pins: snap.pins, panels: snap.panels, savedAt: snap.savedAt ?? 0 };
}

export async function writeSnapshot(snapshot: NewTabSnapshot): Promise<void> {
  await set(KEY, snapshot);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit apps/extension/lib/__tests__/newtab-cache.test.ts`
Expected: PASS — all three cases.

- [ ] **Step 5: Add the API client functions**

Append to `apps/extension/lib/api.ts`. The file's authenticated helper is `request<T>(path, options?)` (defined at line 84) — it attaches the bearer token, refreshes an expired one, and returns the parsed body. Use it; do not introduce a second helper.

```ts
export async function getPins() {
  return request<{ pins: PinnedItem[] }>(API_ROUTES.PINS.LIST);
}

export async function createPin(body: {
  kind: "clip" | "view";
  layout?: "tile" | "panel";
  label?: string;
  iconUrl?: string;
  clipId?: string;
  viewQuery?: ViewQuery;
  position?: number;
}) {
  return request<{ pin: PinnedItem }>(API_ROUTES.PINS.CREATE, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deletePin(id: string) {
  return request<{ ok: true }>(API_ROUTES.PINS.ITEM(id), { method: "DELETE" });
}

export async function reorderPins(ids: string[]) {
  return request<{ ok: true }>(API_ROUTES.PINS.REORDER, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function getPinItems(id: string) {
  return request<{ clips: Summary[] }>(API_ROUTES.PINS.ITEMS(id));
}
```

Add `PinnedItem` and `ViewQuery` to the existing `import type { ... } from "@cliphy/shared";` block at the top of the file.

Note the return shapes: these resolve to the **wrapper object** (`{ pins }`, `{ pin }`, `{ clips }`), matching how `getSummaries` returns `{ summaries: Summary[] }`. Callers destructure.

- [ ] **Step 6: Register the entrypoint**

Create `apps/extension/entrypoints/newtab/index.html` (copying the sidepanel's structure):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cliphy</title>
  </head>
  <body class="m-0 font-sans">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

Create `apps/extension/entrypoints/newtab/main.tsx`:

```tsx
import "../../assets/main.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Sentry, initSentry } from "../../lib/sentry";
import { ErrorFallback } from "../../components/ErrorFallback";
import { App } from "./App";

initSentry();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
```

In `apps/extension/wxt.config.ts`, add to `manifest`:

```ts
    chrome_url_overrides: {
      newtab: "newtab.html",
    },
```

Add `"favicon"` to the existing `permissions` array, and add a `web_accessible_resources` entry alongside the existing one:

```ts
      {
        resources: ["_favicon/*"],
        matches: ["<all_urls>"],
        extension_ids: [],
      },
```

- [ ] **Step 7: Write the shell**

Create `apps/extension/entrypoints/newtab/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { PinnedItem, Summary } from "@cliphy/shared";
import { getPins, getPinItems, getSummaries } from "../../lib/api";
import { readSnapshot, writeSnapshot } from "../../lib/newtab-cache";

export function App() {
  const [pins, setPins] = useState<PinnedItem[]>([]);
  const [panels, setPanels] = useState<Record<string, Summary[]>>({});
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // 1. Paint from cache immediately — no network on the critical path.
    void readSnapshot().then((snap) => {
      if (cancelled || !snap) return;
      setPins(snap.pins);
      setPanels(snap.panels);
    });

    // 2. Revalidate behind it.
    void (async () => {
      try {
        const { pins: freshPins } = await getPins();
        const { summaries: inbox } = await getSummaries();
        const viewPanels = freshPins.filter((p) => p.layout === "panel" && p.kind === "view");
        const resolved: Record<string, Summary[]> = { inbox };
        for (const panel of viewPanels) {
          resolved[panel.id] = (await getPinItems(panel.id)).clips;
        }
        if (cancelled) return;
        setPins(freshPins);
        setPanels(resolved);
        setStale(false);
        await writeSnapshot({ pins: freshPins, panels: resolved, savedAt: Date.now() });
      } catch {
        // Offline or API down: the snapshot is still on screen. Never show an
        // error page on a new tab.
        if (!cancelled) setStale(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-[1400px] p-6">
      {stale && (
        <p className="mb-3 text-xs text-neutral-400">Showing cached view — reconnecting…</p>
      )}
      <section id="tiles" className="mb-8" data-pin-count={pins.length} />
      <section id="panels" data-panel-count={Object.keys(panels).length} />
    </main>
  );
}
```

`getSummaries` is the existing inbox-list function at `apps/extension/lib/api.ts:185`; it returns `{ summaries: Summary[] }`.

- [ ] **Step 8: Verify it loads**

Run: `pnpm dev:extension`

Load `apps/extension/.output/chrome-mv3` unpacked at `chrome://extensions` (Cmd+Shift+. in the macOS file picker shows `.output`). Open a new tab.

Expected: the Cliphy page renders instead of Chrome's new tab, and Chrome shows its "Keep it / Restore" prompt. **Verify explicitly:** press Cmd+T and immediately type — confirm the omnibox has focus and your keystrokes go to the address bar, not the page. Record the result; this is the spec's day-one risk.

- [ ] **Step 9: Commit**

```bash
git add apps/extension/entrypoints/newtab \
        apps/extension/lib/newtab-cache.ts \
        apps/extension/lib/__tests__/newtab-cache.test.ts \
        apps/extension/lib/api.ts \
        apps/extension/wxt.config.ts
git commit -m "add new tab entrypoint with snapshot cache"
```

---

### Task 9: Tile strip

**Files:**

- Create: `apps/extension/entrypoints/newtab/TileStrip.tsx`
- Create: `apps/extension/entrypoints/newtab/__tests__/tileOrder.test.ts`
- Create: `apps/extension/entrypoints/newtab/tileOrder.ts`
- Modify: `apps/extension/entrypoints/newtab/App.tsx`

**Interfaces:**

- Consumes: `PinnedItem` (Task 1), `reorderPins` / `deletePin` (Task 8).
- Produces: `moveTile(ids: string[], from: number, to: number): string[]`; `<TileStrip pins={PinnedItem[]} onReorder={(ids) => void} onRemove={(id) => void} />`.

- [ ] **Step 1: Write the failing test**

Create `apps/extension/entrypoints/newtab/__tests__/tileOrder.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { moveTile } from "../tileOrder";

describe("moveTile", () => {
  beforeEach(() => {
    layer("unit");
    epic("New Tab");
    feature("Tiles");
  });

  it("moves an item later in the list", () => {
    expect(moveTile(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item earlier in the list", () => {
    expect(moveTile(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when the indices match", () => {
    expect(moveTile(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("ignores out-of-range indices", () => {
    expect(moveTile(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(moveTile(["a", "b"], 0, 9)).toEqual(["a", "b"]);
  });

  it("does not mutate the input", () => {
    const input = ["a", "b", "c"];
    moveTile(input, 0, 2);
    expect(input).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit apps/extension/entrypoints/newtab/__tests__/tileOrder.test.ts`
Expected: FAIL — `Cannot find module '../tileOrder'`.

- [ ] **Step 3: Write the implementation**

Create `apps/extension/entrypoints/newtab/tileOrder.ts`:

```ts
/** Reorder tile ids after a drag. Pure, so the drag UI stays trivially testable. */
export function moveTile(ids: string[], from: number, to: number): string[] {
  if (from === to) return [...ids];
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit apps/extension/entrypoints/newtab/__tests__/tileOrder.test.ts`
Expected: PASS — all five cases.

- [ ] **Step 5: Write the tile strip**

Create `apps/extension/entrypoints/newtab/TileStrip.tsx`:

```tsx
import { useState } from "react";
import type { PinnedItem } from "@cliphy/shared";
import { moveTile } from "./tileOrder";

interface TileStripProps {
  pins: PinnedItem[];
  urlFor: (pin: PinnedItem) => string;
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
}

/** Chrome's own favicon cache — no network request, no third-party leak. */
function faviconUrl(pageUrl: string): string {
  const url = new URL(browser.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "32");
  return url.toString();
}

function monogram(label: string): string {
  return (label.trim()[0] ?? "?").toUpperCase();
}

export function TileStrip({ pins, urlFor, onReorder, onRemove }: TileStripProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  if (pins.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {pins.map((pin, index) => {
        const href = urlFor(pin);
        const label = pin.label ?? href;
        return (
          <a
            key={pin.id}
            href={href}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex === null) return;
              onReorder(
                moveTile(
                  pins.map((p) => p.id),
                  dragIndex,
                  index,
                ),
              );
              setDragIndex(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onRemove(pin.id);
            }}
            className="flex w-24 flex-col items-center gap-1 border-2 border-black bg-white p-2 shadow-[3px_3px_0_0_#000]"
          >
            {broken[pin.id] || !href ? (
              <span className="flex h-8 w-8 items-center justify-center bg-black text-sm font-bold text-white">
                {monogram(label)}
              </span>
            ) : (
              <img
                src={faviconUrl(href)}
                alt=""
                width={32}
                height={32}
                onError={() => setBroken((b) => ({ ...b, [pin.id]: true }))}
              />
            )}
            <span className="w-full truncate text-center text-[11px] font-bold">{label}</span>
          </a>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Wire it into the page**

In `apps/extension/entrypoints/newtab/App.tsx`, replace the `<section id="tiles" …/>` placeholder with the real strip. Add a lookup from a clip pin to its URL using the panel data already loaded, plus the reorder and remove handlers:

```tsx
const clipById = new Map(
  Object.values(panels)
    .flat()
    .map((c) => [c.id, c]),
);

const urlFor = (pin: PinnedItem) => {
  const clip = pin.clipId ? clipById.get(pin.clipId) : undefined;
  return clip?.sourceUrl ?? clip?.videoUrl ?? "";
};

const handleReorder = (ids: string[]) => {
  setPins((prev) => ids.map((id) => prev.find((p) => p.id === id)!).filter(Boolean));
  void reorderPins(ids);
};

const handleRemove = (id: string) => {
  setPins((prev) => prev.filter((p) => p.id !== id));
  void deletePin(id);
};
```

```tsx
<section className="mb-8">
  <TileStrip
    pins={pins.filter((p) => p.layout === "tile")}
    urlFor={urlFor}
    onReorder={handleReorder}
    onRemove={handleRemove}
  />
</section>
```

Import `TileStrip`, `reorderPins`, and `deletePin` at the top.

- [ ] **Step 7: Verify in the browser**

Run: `pnpm dev:extension`, reload the extension, open a new tab.

Expected: pinned tiles render with real favicons. Drag one to a new position, then **restart Chrome** and confirm the order persisted. Right-click removes a tile.

- [ ] **Step 8: Commit**

```bash
git add apps/extension/entrypoints/newtab/TileStrip.tsx \
        apps/extension/entrypoints/newtab/tileOrder.ts \
        apps/extension/entrypoints/newtab/__tests__/tileOrder.test.ts \
        apps/extension/entrypoints/newtab/App.tsx
git commit -m "add new tab tile strip with drag reorder"
```

---

### Task 10: Capture bar

**Files:**

- Create: `apps/extension/entrypoints/newtab/CaptureBar.tsx`
- Modify: `apps/extension/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/lib/api.ts`

**Interfaces:**

- Consumes: `createPin` (Task 8), `POST /api/clips` with `tier` (Task 6).
- Produces: `addBookmark(url: string, label?: string): Promise<{ clip: Summary; pin: PinnedItem }>` in `apps/extension/lib/api.ts`; `<CaptureBar onAdded={(pin) => void} />`.

- [ ] **Step 1: Add the API function**

Append to `apps/extension/lib/api.ts`:

```ts
/**
 * Add a site as a bookmark tile: a metadata-tier clip (no Claude pass, but
 * still embedded so it stays searchable) plus a tile pin pointing at it.
 */
export async function addBookmark(
  url: string,
  label?: string,
): Promise<{ clip: Summary; pin: PinnedItem }> {
  const { clip } = await request<{ clip: Summary }>(API_ROUTES.CLIPS.ADD, {
    method: "POST",
    body: JSON.stringify({ url, tier: "metadata" }),
  });
  const { pin } = await createPin({
    kind: "clip",
    layout: "tile",
    clipId: clip.id,
    label: label ?? clip.videoTitle,
  });
  return { clip, pin };
}
```

- [ ] **Step 2: Write the component**

Create `apps/extension/entrypoints/newtab/CaptureBar.tsx`:

```tsx
import { useState } from "react";
import type { PinnedItem } from "@cliphy/shared";
import { addBookmark } from "../../lib/api";

interface CaptureBarProps {
  onAdded: (pin: PinnedItem) => void;
}

export function CaptureBar({ onAdded }: CaptureBarProps) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const { pin } = await addBookmark(trimmed);
      onAdded(pin);
      setUrl("");
    } catch {
      setError("Could not add that link.");
    } finally {
      setBusy(false);
    }
  }

  async function clipCurrentTab() {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.url) await submit(tab.url);
  }

  return (
    <div className="mb-6 flex items-center gap-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit(url);
        }}
        placeholder="Paste a URL to pin…"
        disabled={busy}
        className="flex-1 border-2 border-black px-3 py-2 text-sm shadow-[3px_3px_0_0_#000]"
      />
      <button
        type="button"
        onClick={() => void clipCurrentTab()}
        disabled={busy}
        className="border-2 border-black px-3 py-2 text-sm font-bold shadow-[3px_3px_0_0_#000]"
      >
        Clip this tab
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the page**

In `App.tsx`, render `<CaptureBar onAdded={(pin) => setPins((prev) => [...prev, pin])} />` above the tile strip section, and import it.

- [ ] **Step 4: Verify in the browser**

Run: `pnpm dev:extension`, reload, open a new tab.

Expected: pasting `https://linear.app` and pressing Enter adds a tile within about a second, with the Linear favicon and title. Confirm in Supabase that the row has `enrichment_tier = 'metadata'` and a non-null `embedding`:

```sql
select video_title, enrichment_tier, (embedding is not null) as embedded
from clips where source_url = 'https://linear.app';
```

Expected: `metadata`, `embedded = true`. The embedding may take a few seconds to appear — re-run the query.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/newtab/CaptureBar.tsx \
        apps/extension/entrypoints/newtab/App.tsx \
        apps/extension/lib/api.ts
git commit -m "add new tab capture bar for bookmarks"
```

---

### Task 11: Panels with peek-inline and archive

**Files:**

- Create: `apps/extension/entrypoints/newtab/Panel.tsx`
- Modify: `apps/extension/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/lib/api.ts`

**Interfaces:**

- Consumes: `MasonryGrid`, `ClipCard`, `toPanelItem` (Task 7); archive endpoints (Task 3).
- Produces: `archiveClip(id)` / `unarchiveClip(id)` in `apps/extension/lib/api.ts`; `<Panel title={string} clips={Summary[]} columns={number} onArchive={(id) => void} />`.

- [ ] **Step 1: Add the API functions**

Append to `apps/extension/lib/api.ts`:

```ts
export async function archiveClip(id: string) {
  return request<{ id: string; archivedAt: string }>(API_ROUTES.SUMMARIES.ARCHIVE(id), {
    method: "POST",
  });
}

export async function unarchiveClip(id: string) {
  return request<{ id: string; archivedAt: null }>(API_ROUTES.SUMMARIES.UNARCHIVE(id), {
    method: "POST",
  });
}
```

- [ ] **Step 2: Write the panel component**

Create `apps/extension/entrypoints/newtab/Panel.tsx`:

```tsx
import { useState } from "react";
import type { Summary } from "@cliphy/shared";
import { MasonryGrid, ClipCard, toPanelItem } from "@cliphy/shared";

interface PanelProps {
  title: string;
  clips: Summary[];
  columns?: number;
  onArchive?: (id: string) => void;
}

export function Panel({ title, clips, columns = 4, onArchive }: PanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-neutral-500">{title}</h2>
      {clips.length === 0 ? (
        <p className="text-sm text-neutral-400">Nothing here yet.</p>
      ) : (
        <MasonryGrid
          items={clips}
          columns={columns}
          renderItem={(clip) => (
            <ClipCard
              key={clip.id}
              item={toPanelItem(clip)}
              category={clip.category}
              expanded={expanded === clip.id}
              onToggle={(id) => setExpanded((cur) => (cur === id ? null : id))}
              onOpen={(id) => {
                const target = clips.find((c) => c.id === id);
                const href = target?.sourceUrl ?? target?.videoUrl;
                if (href) window.open(href, "_blank");
              }}
              onArchive={onArchive}
            />
          )}
        />
      )}
    </section>
  );
}
```

An empty panel renders its heading and an empty state rather than disappearing — the spec requires the user to be able to tell "no matches" from "the panel vanished."

- [ ] **Step 3: Render the panels**

In `App.tsx`, replace the `<section id="panels" …/>` placeholder:

```tsx
<Panel title="Inbox" clips={panels.inbox ?? []} onArchive={handleArchive} />;
{
  pins
    .filter((p) => p.layout === "panel" && p.kind === "view")
    .map((pin) => (
      <Panel
        key={pin.id}
        title={pin.label ?? "View"}
        clips={panels[pin.id] ?? []}
        onArchive={handleArchive}
      />
    ));
}
```

Add the archive handler with optimistic removal and undo:

```tsx
const [undo, setUndo] = useState<{ id: string; panelId: string; clip: Summary } | null>(null);

const handleArchive = (id: string) => {
  let removed: Summary | undefined;
  let fromPanel = "inbox";
  setPanels((prev) => {
    const next: Record<string, Summary[]> = {};
    for (const [panelId, clips] of Object.entries(prev)) {
      const hit = clips.find((c) => c.id === id);
      if (hit && !removed) {
        removed = hit;
        fromPanel = panelId;
      }
      next[panelId] = clips.filter((c) => c.id !== id);
    }
    return next;
  });
  if (removed) setUndo({ id, panelId: fromPanel, clip: removed });
  void archiveClip(id);
};

const handleUndo = () => {
  if (!undo) return;
  setPanels((prev) => ({
    ...prev,
    [undo.panelId]: [undo.clip, ...(prev[undo.panelId] ?? [])],
  }));
  void unarchiveClip(undo.id);
  setUndo(null);
};
```

And render the undo affordance near the top of the `<main>`:

```tsx
{
  undo && (
    <div className="mb-3 flex items-center gap-2 border-2 border-black bg-yellow-100 px-3 py-2 text-sm">
      <span>Archived.</span>
      <button type="button" onClick={handleUndo} className="font-bold underline">
        Undo
      </button>
    </div>
  );
}
```

Import `Panel`, `archiveClip`, and `unarchiveClip`.

- [ ] **Step 4: Verify in the browser**

Run: `pnpm dev:extension`, reload, open a new tab.

Expected:

- The Inbox panel renders your clips in a balanced multi-column masonry.
- Clicking a card title expands it in place, showing the summary and Open/Archive buttons — the page does not navigate.
- Archive removes the card immediately and shows an Undo banner; Undo puts it back.
- **Throttle the network to Offline in DevTools, then open a new tab.** The page must still paint from the snapshot with the "Showing cached view" note, and must not show an error page.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/newtab/Panel.tsx \
        apps/extension/entrypoints/newtab/App.tsx \
        apps/extension/lib/api.ts
git commit -m "add new tab panels with peek inline and archive"
```

---

### Task 12: Promote-to-new-tab action and docs

**Files:**

- Modify: `apps/extension/entrypoints/summaries/App.tsx`
- Create: `docs/decisions/0045-content-store-vs-placement-store-for-pins.md`
- Create: `docs/devlog/2026-09-06-newtab-pins-and-panels.md`
- Modify: `docs/decisions/index.md` (via `lore reindex decision`)

**Interfaces:**

- Consumes: `createPin` (Task 8).
- Produces: a "Pin to new tab" control on existing clip surfaces.

- [ ] **Step 1: Add the promote action**

In `apps/extension/entrypoints/summaries/App.tsx`, add a "Pin to new tab" button to each clip's action row, immediately before the existing delete control.

Before writing it, open the file and find the delete button's JSX. Copy its `className` string **verbatim** onto the new button so the two match — this file already has a settled button style and the goal is to blend in, not to introduce a variant:

```tsx
<button
  type="button"
  onClick={() =>
    void createPin({
      kind: "clip",
      layout: "tile",
      clipId: clip.id,
      label: clip.videoTitle,
    })
  }
  className={/* the exact className copied from the neighbouring delete button */}
>
  Pin to new tab
</button>
```

Import `createPin` from `../../lib/api`. Note the local variable holding the clip in that file may be named something other than `clip` — use whatever the surrounding `map` binds.

- [ ] **Step 2: Verify**

Run: `pnpm dev:extension`, reload. Open the summaries page, pin a clip, then open a new tab.

Expected: the clip appears as a tile in the strip.

- [ ] **Step 3: Write the ADR**

Create `docs/decisions/0045-content-store-vs-placement-store-for-pins.md`. Read `docs/.lore/types/decision.schema.yaml` first and follow its `prompt` field for structure. The decision to record: pins live in a separate `pinned_items` placement table rather than as flags on `clips`, because view pins (and future connector pins) are not clips, while grid ordering must live in one table. Include the rejected alternative (`clips.pinned_at` + `pin_position`) and why it fails once a view can be pinned.

- [ ] **Step 4: Write the devlog**

Run: `/devlog` and let it generate the entry rather than hand-formatting one.

- [ ] **Step 5: Reindex and validate**

```bash
cd /Users/suki/dev/cliphy
node ~/.local/bin/lore reindex decision && node ~/.local/bin/lore validate decision
node ~/.local/bin/lore reindex devlog && node ~/.local/bin/lore validate devlog
```

Expected: `valid` for both.

- [ ] **Step 6: Final verification**

```bash
pnpm test:unit && pnpm lint && pnpm build:extension
```

Expected: all pass.

- [ ] **Step 7: Commit and push**

```bash
git add apps/extension/entrypoints/summaries/App.tsx docs/
git commit -m "add pin to new tab action and document pins design"
git push
```

---

## Deferred (do not build)

Recorded so a future session does not re-derive them. Full reasoning lives in the spec's _Deferred_ section.

- **Connectors of any kind** — no `Connector` interface, no `user_connectors`, no OAuth, no GitHub, no Gmail. `pinned_items.kind` gains `'connector'` with a one-line constraint change when the time comes; `PanelItem` is already the seam.
- **Gmail specifically** — `gmail.readonly` is a _restricted_ scope requiring a CASA assessment, and Google's personal-use exemption does not apply to an OAuth client with public extension users. See `~/dev/wiki/concepts/oauth-scope-tiers-and-connector-compliance.md`.
- **Pin expiry / auto-demote** — `pinned_at` is recorded from Task 1 because it cannot be reconstructed; the policy waits for lived evidence. Adding `pin_expires_at` later is a nullable column with no backfill.
- **Pins on mobile.**
- **DOM masonry virtualization.**
- **Fractional indexing for `position`** — revisit only if pins become collaborative or number in the hundreds.
- **Refactoring `apps/web/src/pages/Dashboard.tsx` onto the shared cards.** Task 7 puts `ClipCard` and `MasonryGrid` in `packages/shared/src/components`, which is the extension+web shared UI directory, so the web dashboard _can_ consume them — but this plan does not rewrite it. That refactor is a separate, self-contained follow-up; doing it here would mean re-testing an unrelated surface in the middle of the new tab build.
