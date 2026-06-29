# Clips Generalization + Web Share Target — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the `summaries` table into a universal `clips` model, add a Web Share Target so users can save tweets from the iOS/Android share sheet, and embed every clip on save for future semantic search.

**Architecture:** Rename `summaries` → `clips` in Postgres with new universal columns (`source_type`, `content`, `author`, `embedding`), add a `POST /api/clips` endpoint for non-YouTube content, and run a new `embed-clip` Inngest function after every save. The web app gains a `/save` route and PWA manifest so mobile share sheets can route to it.

**Tech Stack:** Hono, Supabase (pgvector), Inngest, Voyage AI (embeddings), React + React Router v6, Vitest, pnpm workspaces

## Global Constraints

- `source_type` values: only `'youtube'` and `'tweet'` in this phase
- Embedding dimension: 1024 (Voyage AI `voyage-3` model)
- All existing YouTube behavior must be preserved — no regressions
- Auth: server routes use `authMiddleware` from `../middleware/auth.js`; user ID via `c.get("userId")`
- Server `AppEnv` type imported from `"../env.js"`
- Table references must change from `"summaries"` to `"clips"` everywhere in the server
- Mapper returns `Summary` type (backwards compat — `Clip` is a new alias, not a rename)
- New env var required: `VOYAGE_API_KEY`

---

### Task 1: DB Migration — add new columns and rename to `clips`

**Files:**
- Create: `apps/server/supabase/migrations/022_clips_generalization.sql`

**Interfaces:**
- Produces: `clips` table with columns `source_type text not null default 'youtube'`, `source_url text`, `content text`, `author text`, `published_at timestamptz`, `source_metadata jsonb`, `embedding vector(1024)`; `youtube_video_id` made nullable

- [ ] **Step 1: Write the migration file**

```sql
-- apps/server/supabase/migrations/022_clips_generalization.sql

-- Enable pgvector (idempotent — safe to run even if already enabled)
create extension if not exists vector;

-- Make youtube_video_id nullable so non-YouTube clips can be inserted
alter table summaries
  alter column youtube_video_id drop not null;

-- Add universal columns
alter table summaries
  add column if not exists source_type    text not null default 'youtube',
  add column if not exists source_url     text,
  add column if not exists content        text,
  add column if not exists author         text,
  add column if not exists published_at   timestamptz,
  add column if not exists source_metadata jsonb,
  add column if not exists embedding      vector(1024);

-- Backfill existing YouTube rows
update summaries
set
  source_url = video_url,
  author     = video_channel
where source_type = 'youtube';

-- HNSW index for cosine similarity (works on partial data — null rows are excluded)
create index if not exists clips_embedding_idx
  on summaries using hnsw (embedding vector_cosine_ops);

-- Rename the table (FKs and RLS policies follow automatically in Postgres)
alter table summaries rename to clips;
```

- [ ] **Step 2: Apply migration**

```bash
cd apps/server
npx supabase db push
```

Expected: migration applied, `clips` table exists with new columns.

- [ ] **Step 3: Verify in Supabase dashboard**

Run in the SQL editor:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'clips'
order by ordinal_position;
```

Expected: columns `source_type`, `source_url`, `content`, `author`, `published_at`, `source_metadata`, `embedding` all present. `youtube_video_id` shows `is_nullable = YES`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/supabase/migrations/022_clips_generalization.sql
git commit -m "add clips generalization migration"
```

---

### Task 2: Shared Types — extend `Summary` with Clip fields

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/constants.ts`

**Interfaces:**
- Produces: `Summary` type with new fields `sourceType`, `sourceUrl`, `content`, `author`, `publishedAt`, `sourceMetadata`; `videoId` made optional; `Clip` type alias; `ClipAddRequest`/`ClipAddResponse` types; `API_ROUTES.CLIPS.ADD`

- [ ] **Step 1: Extend `Summary` in `packages/shared/src/types.ts`**

Replace the existing `Summary` interface (currently lines 56–75) with:

```typescript
export interface Summary {
  id: string;
  userId: string;
  // Universal fields (all source types)
  sourceType: "youtube" | "tweet";
  sourceUrl?: string;
  content?: string;
  author?: string;
  publishedAt?: string;
  sourceMetadata?: Record<string, unknown>;
  // YouTube-specific (kept for backwards compat — undefined for tweets)
  videoId?: string;
  videoTitle?: string;
  videoUrl?: string;
  videoChannel?: string;
  videoDurationSeconds?: number;
  // Shared processing fields
  status: SummaryStatus;
  summaryJson?: SummaryJson;
  summaryLanguage?: string;
  translations?: Partial<Record<import("./constants.js").SummaryLanguageCode, SummaryJson>>;
  errorMessage?: string;
  tags: string[];
  userNotes?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Forward alias — use Clip in new code
export type Clip = Summary;
export type ClipStatus = SummaryStatus;
```

Also add after the existing `QueueAddResponse` type:

```typescript
export interface ClipAddRequest {
  sourceType: "youtube" | "tweet";
  sourceUrl: string;
  content?: string;
  author?: string;
  publishedAt?: string;
  title?: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface ClipAddResponse {
  clip: Summary;
}
```

- [ ] **Step 2: Add `CLIPS` to `API_ROUTES` in `packages/shared/src/constants.ts`**

Add after the existing `QUEUE` block:

```typescript
CLIPS: {
  ADD: "/api/clips",
},
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm --filter=@cliphy/shared build
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/constants.ts
git commit -m "extend Summary type with universal clip fields; add Clip alias"
```

---

### Task 3: Mapper — `toClip()` + rename all table references

**Files:**
- Modify: `apps/server/src/lib/mappers.ts`
- Modify: `apps/server/src/lib/__tests__/mappers.test.ts`
- Modify: all server files containing `.from("summaries")` (sweep)

**Interfaces:**
- Consumes: `Summary` type with new fields from Task 2
- Produces: `toClip(row): Summary` mapping all new columns; `toSummary` kept as alias

- [ ] **Step 1: Write failing test for `toClip` in `apps/server/src/lib/__tests__/mappers.test.ts`**

First, update the import at the top of the file to include `toClip`:

```typescript
import { toSummary, toClip } from "../mappers.js";
```

Then add after the existing `toSummary` describe block:

```typescript
const tweetRow = {
  id: "clip-1",
  user_id: "user-1",
  youtube_video_id: null,
  source_type: "tweet",
  source_url: "https://x.com/user/status/123",
  content: "Hello world",
  author: "@user",
  published_at: "2026-06-29T10:00:00Z",
  source_metadata: { tweetId: "123" },
  video_title: null,
  video_url: null,
  video_channel: null,
  video_duration_seconds: null,
  status: "completed",
  summary_json: null,
  error_message: null,
  tags: [],
  created_at: "2026-06-29T10:00:00Z",
  updated_at: "2026-06-29T10:00:00Z",
};

describe("toClip", () => {
  beforeEach(() => {
    layer("unit");
    epic("Data");
    feature("DB Mapping");
  });

  it("maps tweet row to Clip with sourceType and content", () => {
    const clip = toClip(tweetRow);

    expect(clip.id).toBe("clip-1");
    expect(clip.sourceType).toBe("tweet");
    expect(clip.sourceUrl).toBe("https://x.com/user/status/123");
    expect(clip.content).toBe("Hello world");
    expect(clip.author).toBe("@user");
    expect(clip.publishedAt).toBe("2026-06-29T10:00:00Z");
    expect(clip.sourceMetadata).toEqual({ tweetId: "123" });
    expect(clip.videoId).toBeUndefined();
    expect(clip.summaryJson).toBeUndefined();
    expect(clip.status).toBe("completed");
  });

  it("maps YouTube row preserving existing fields", () => {
    const ytRow = {
      ...tweetRow,
      youtube_video_id: "dQw4w9WgXcQ",
      source_type: "youtube",
      source_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
      content: null,
      author: "Test Channel",
      video_title: "Test Video",
      video_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
      video_channel: "Test Channel",
      video_duration_seconds: 120,
    };
    const clip = toClip(ytRow);

    expect(clip.sourceType).toBe("youtube");
    expect(clip.videoId).toBe("dQw4w9WgXcQ");
    expect(clip.videoTitle).toBe("Test Video");
    expect(clip.videoChannel).toBe("Test Channel");
    expect(clip.videoDurationSeconds).toBe(120);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm test:unit -- mappers
```

Expected: FAIL — `toClip is not a function`

- [ ] **Step 3: Implement `toClip` in `apps/server/src/lib/mappers.ts`**

Add after the existing `toSummary` function:

```typescript
export function toClip(row: Record<string, unknown>): Summary {
  return {
    id:                   row.id as string,
    userId:               row.user_id as string,
    sourceType:           (row.source_type as Summary["sourceType"]) ?? "youtube",
    sourceUrl:            (row.source_url as string) ?? undefined,
    content:              (row.content as string) ?? undefined,
    author:               (row.author as string) ?? undefined,
    publishedAt:          (row.published_at as string) ?? undefined,
    sourceMetadata:       (row.source_metadata as Record<string, unknown>) ?? undefined,
    videoId:              (row.youtube_video_id as string) ?? undefined,
    videoTitle:           (row.video_title as string) ?? undefined,
    videoUrl:             (row.video_url as string) ?? undefined,
    videoChannel:         (row.video_channel as string) ?? undefined,
    videoDurationSeconds: (row.video_duration_seconds as number) ?? undefined,
    status:               row.status as Summary["status"],
    summaryJson:          (row.summary_json as Summary["summaryJson"]) ?? undefined,
    summaryLanguage:      (row.summary_language as string) ?? undefined,
    translations:         (row.translations as Summary["translations"]) ?? undefined,
    errorMessage:         (row.error_message as string) ?? undefined,
    tags:                 (row.tags as string[]) ?? [],
    userNotes:            (row.user_notes as string) ?? undefined,
    createdAt:            row.created_at as string,
    updatedAt:            row.updated_at as string,
  };
}

// Backwards-compat alias — existing callers keep working
export const toSummary = toClip;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test:unit -- mappers
```

Expected: all mapper tests PASS.

- [ ] **Step 5: Sweep all `.from("summaries")` references in the server**

```bash
grep -rl '\.from("summaries")' apps/server/src/ | xargs sed -i 's/\.from("summaries")/.from("clips")/g'
```

Verify nothing remains:

```bash
grep -r '\.from("summaries")' apps/server/src/
```

Expected: no output.

- [ ] **Step 6: Build server to catch any remaining type errors**

```bash
pnpm --filter=server build
```

Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/lib/mappers.ts apps/server/src/lib/__tests__/mappers.test.ts
git add $(grep -rl '\.from("clips")' apps/server/src/)
git commit -m "add toClip mapper; rename all summaries table refs to clips"
```

---

### Task 4: Embedding service

**Files:**
- Create: `apps/server/src/services/embedding.ts`
- Create: `apps/server/src/services/__tests__/embedding.test.ts`

**Interfaces:**
- Produces: `generateEmbedding(text: string): Promise<number[]>` — calls Voyage AI, returns 1024-dim vector

- [ ] **Step 1: Add `VOYAGE_API_KEY` to your `.env` file**

```
VOYAGE_API_KEY=your_key_here
```

Get a key at https://dash.voyageai.com. The free tier has 50M tokens/month, enough for development.

- [ ] **Step 2: Write failing test at `apps/server/src/services/__tests__/embedding.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

describe("generateEmbedding", () => {
  beforeEach(() => {
    layer("unit");
    epic("Embedding");
    feature("Voyage AI");
    process.env.VOYAGE_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 1024-dim array from Voyage AI", async () => {
    const mockEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: mockEmbedding }] }),
    } as unknown as Response);

    const { generateEmbedding } = await import("../embedding.js");
    const result = await generateEmbedding("hello world");

    expect(result).toHaveLength(1024);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ input: "hello world", model: "voyage-3" }),
      })
    );
  });

  it("throws on non-OK response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    } as unknown as Response);

    const { generateEmbedding } = await import("../embedding.js");
    await expect(generateEmbedding("test")).rejects.toThrow(
      "Voyage AI embedding failed: 401"
    );
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
pnpm test:unit -- embedding
```

Expected: FAIL — `Cannot find module '../embedding.js'`

- [ ] **Step 4: Create `apps/server/src/services/embedding.ts`**

```typescript
const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3";

export async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: text, model: VOYAGE_MODEL }),
  });

  if (!res.ok) {
    throw new Error(`Voyage AI embedding failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
pnpm test:unit -- embedding
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/embedding.ts apps/server/src/services/__tests__/embedding.test.ts
git commit -m "add Voyage AI embedding service"
```

---

### Task 5: `embed-clip` Inngest function

**Files:**
- Create: `apps/server/src/functions/embed-clip.ts`
- Create: `apps/server/src/functions/__tests__/embed-clip.test.ts`

**Interfaces:**
- Consumes: `inngest` client from `"../lib/inngest.js"`; `supabase` from `"../lib/supabase.js"`; `generateEmbedding` from `"../services/embedding.js"`
- Consumes event: `"clip/embed.requested"` with `data: { clipId: string }`
- Produces: exported `embedClip` Inngest function; updates `embedding` column in `clips` for the given `clipId`

- [ ] **Step 1: Write failing test at `apps/server/src/functions/__tests__/embed-clip.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

// vi.mock calls are hoisted — must appear before imports of the module under test
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
}));
vi.mock("../../services/embedding.js", () => ({
  generateEmbedding: vi.fn(),
}));

import { buildEmbedText } from "../embed-clip.js";

describe("buildEmbedText", () => {
  beforeEach(() => {
    layer("unit");
    epic("Embedding");
    feature("embed-clip");
  });

  it("builds tweet embed text as '@handle: content'", () => {
    const text = buildEmbedText({
      source_type: "tweet",
      author: "@alice",
      content: "Hello world",
      summary_json: null,
    });
    expect(text).toBe("@alice: Hello world");
  });

  it("builds YouTube embed text from summary and keyPoints", () => {
    const text = buildEmbedText({
      source_type: "youtube",
      author: "Channel",
      content: null,
      summary_json: {
        summary: "Great video about cats",
        keyPoints: ["cats are fluffy", "cats sleep a lot"],
      },
    });
    expect(text).toBe("Great video about cats cats are fluffy cats sleep a lot");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm test:unit -- embed-clip
```

Expected: FAIL — `Cannot find module '../embed-clip.js'`

- [ ] **Step 3: Create `apps/server/src/functions/embed-clip.ts`**

```typescript
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { generateEmbedding } from "../services/embedding.js";
import type { Summary } from "@cliphy/shared";

type ClipRow = {
  source_type: string;
  author: string | null;
  content: string | null;
  summary_json: Summary["summaryJson"] | null;
};

export function buildEmbedText(clip: ClipRow): string {
  if (clip.source_type === "tweet") {
    return `${clip.author ?? ""}: ${clip.content ?? ""}`.trim();
  }
  const sj = clip.summary_json;
  const keyPoints = sj?.keyPoints?.join(" ") ?? "";
  return `${sj?.summary ?? ""} ${keyPoints}`.trim();
}

export const embedClip = inngest.createFunction(
  { id: "embed-clip", retries: 3 },
  { event: "clip/embed.requested" },
  async ({ event, step }) => {
    const { clipId } = event.data as { clipId: string };

    const clip = await step.run("fetch-clip", async () => {
      const { data, error } = await supabase
        .from("clips")
        .select("id, source_type, content, summary_json, author")
        .eq("id", clipId)
        .single();
      if (error) throw new Error(`Failed to fetch clip ${clipId}: ${error.message}`);
      return data as ClipRow & { id: string };
    });

    await step.run("store-embedding", async () => {
      const embedText = buildEmbedText(clip);
      const embedding = await generateEmbedding(embedText);
      const { error } = await supabase
        .from("clips")
        .update({ embedding })
        .eq("id", clipId);
      if (error) throw new Error(`Failed to store embedding for ${clipId}: ${error.message}`);
    });

    return { clipId, status: "embedded" };
  }
);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test:unit -- embed-clip
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/functions/embed-clip.ts apps/server/src/functions/__tests__/embed-clip.test.ts
git commit -m "add embed-clip Inngest function"
```

---

### Task 6: Register `embed-clip` + chain to `summarize-video`

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/functions/summarize-video.ts`

**Interfaces:**
- Consumes: `embedClip` from `"./functions/embed-clip.js"`
- Produces: `embed-clip` registered in Inngest; `summarize-video` fires `"clip/embed.requested"` after saving result

- [ ] **Step 1: Register `embedClip` in `apps/server/src/app.ts`**

Add the import at the top of the file with the other function imports:

```typescript
import { embedClip } from "./functions/embed-clip.js";
```

Add `embedClip` to the `functions` array in the Inngest serve handler (around line 76):

```typescript
functions: [
  summarizeVideo,
  pollSubscriptionsCron,
  embedClip,      // ← add this
],
```

- [ ] **Step 2: Chain embed step at end of `apps/server/src/functions/summarize-video.ts`**

After the existing `save-result` step (and before the final `return`), add:

```typescript
await step.run("request-embedding", async () => {
  await inngest.send({
    name: "clip/embed.requested",
    data: { clipId: summaryId },
  });
});
```

- [ ] **Step 3: Build server to confirm no type errors**

```bash
pnpm --filter=server build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/functions/summarize-video.ts
git commit -m "register embed-clip; chain embedding after YouTube summarization"
```

---

### Task 7: `/api/clips` endpoint

**Files:**
- Create: `apps/server/src/routes/clips.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: `authMiddleware`, `supabase`, `inngest`, `toClip`, `AppEnv`
- Produces: `POST /api/clips` — inserts tweet clip into `clips` table, fires `"clip/embed.requested"`, returns `{ clip }` with 201

- [ ] **Step 1: Create `apps/server/src/routes/clips.ts`**

```typescript
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import { toClip } from "../lib/mappers.js";
import type { ClipAddRequest } from "@cliphy/shared";

export const clipsRoutes = new Hono<AppEnv>();

clipsRoutes.use("*", authMiddleware);

clipsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<ClipAddRequest>();

  if (!body.sourceType || !["youtube", "tweet"].includes(body.sourceType)) {
    return c.json({ error: "Invalid sourceType" }, 400);
  }
  if (!body.sourceUrl) {
    return c.json({ error: "sourceUrl is required" }, 400);
  }
  if (body.sourceType === "tweet" && !body.content) {
    return c.json({ error: "content is required for tweets" }, 400);
  }

  const { data: row, error } = await supabase
    .from("clips")
    .insert({
      user_id:         userId,
      source_type:     body.sourceType,
      source_url:      body.sourceUrl,
      content:         body.content ?? null,
      author:          body.author ?? null,
      published_at:    body.publishedAt ?? null,
      video_title:     body.title ?? null,
      source_metadata: body.sourceMetadata ?? null,
      status:          "completed",
      tags:            [],
    })
    .select("*")
    .single();

  if (error) {
    return c.json({ error: "Failed to save clip" }, 500);
  }

  await inngest.send({
    name: "clip/embed.requested",
    data: { clipId: row.id },
  });

  return c.json({ clip: toClip(row) }, 201);
});
```

- [ ] **Step 2: Register the route in `apps/server/src/app.ts`**

Add import:

```typescript
import { clipsRoutes } from "./routes/clips.js";
```

Add route (after the existing `app.route("/queue", ...)` line):

```typescript
app.route("/clips", clipsRoutes);
```

- [ ] **Step 3: Build server**

```bash
pnpm --filter=server build
```

Expected: clean build.

- [ ] **Step 4: Smoke test with curl (requires local server running)**

```bash
# In one terminal:
pnpm dev:server

# In another (replace TOKEN with a real Supabase access token):
curl -X POST http://localhost:3001/api/clips \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "sourceType": "tweet",
    "sourceUrl": "https://x.com/user/status/123456",
    "content": "Test tweet content",
    "author": "@user",
    "sourceMetadata": { "tweetId": "123456" }
  }'
```

Expected: `201` response with `{ "clip": { "id": "...", "sourceType": "tweet", ... } }`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/clips.ts apps/server/src/app.ts
git commit -m "add POST /api/clips endpoint for non-YouTube clips"
```

---

### Task 8: PWA manifest

**Files:**
- Create: `apps/web/public/manifest.webmanifest`
- Modify: `apps/web/index.html`

**Interfaces:**
- Produces: `cliphy.app` registered as a Web Share Target; `/save` route declared as the share target action

**Note:** The manifest requires 192×192 and 512×512 PNG icons. Export the existing `apps/web/public/logo.svg` as both sizes and place them at `apps/web/public/icon-192.png` and `apps/web/public/icon-512.png` before deploying. Any image editor or `rsvg-convert` can do this: `rsvg-convert -w 192 -h 192 logo.svg -o icon-192.png`.

- [ ] **Step 1: Create `apps/web/public/manifest.webmanifest`**

```json
{
  "name": "Cliphy",
  "short_name": "Cliphy",
  "description": "Save and summarize content from anywhere",
  "start_url": "/dashboard",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#000000",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "share_target": {
    "action": "/save",
    "method": "GET",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url"
    }
  }
}
```

- [ ] **Step 2: Add manifest link to `apps/web/index.html`**

Add inside `<head>` after the existing `<link rel="icon">` line:

```html
<link rel="manifest" href="/manifest.webmanifest" />
```

- [ ] **Step 3: Export PNG icons from the SVG logo**

```bash
# Install rsvg-convert if needed: sudo apt install librsvg2-bin
rsvg-convert -w 192 -h 192 apps/web/public/logo.svg -o apps/web/public/icon-192.png
rsvg-convert -w 512 -h 512 apps/web/public/logo.svg -o apps/web/public/icon-512.png
```

If `rsvg-convert` is not available, export manually from Figma/Illustrator/browser dev tools.

- [ ] **Step 4: Verify manifest is valid**

Start the dev server and open Chrome DevTools → Application → Manifest. Confirm all fields load without warnings.

```bash
pnpm dev
# Open http://localhost:5173 in Chrome → DevTools → Application → Manifest
```

Expected: manifest shown with name "Cliphy", icons, and share_target entry visible.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/manifest.webmanifest apps/web/index.html apps/web/public/icon-192.png apps/web/public/icon-512.png
git commit -m "add PWA manifest with Web Share Target"
```

---

### Task 9: `/save` page + API wiring

**Files:**
- Create: `apps/web/src/pages/SavePage.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `"../lib/auth-context"`; `request<T>()` from `"./api"` (internal); `API_ROUTES.CLIPS.ADD` from `@cliphy/shared`; `ClipAddRequest`, `ClipAddResponse` from `@cliphy/shared`
- Produces: `addClip(body: ClipAddRequest): Promise<ClipAddResponse>` in `api.ts`; `/save` route in the React app that handles iOS/Android share sheet params

- [ ] **Step 1: Add `addClip` to `apps/web/src/lib/api.ts`**

Add after the existing imports (add to the existing import from `@cliphy/shared`):

```typescript
import type {
  // ... existing imports ...
  ClipAddRequest,
  ClipAddResponse,
} from "@cliphy/shared";
```

Add after the existing `deleteSubscription` function:

```typescript
// Clips
export async function addClip(body: ClipAddRequest) {
  return request<ClipAddResponse>(API_ROUTES.CLIPS.ADD, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 2: Create `apps/web/src/pages/SavePage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth-context";
import { addClip } from "../lib/api";

function parseTweetUrl(url: string): { author: string; tweetId: string } | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)\/status\/(\d+)/);
  if (!match) return null;
  return { author: `@${match[1]}`, tweetId: match[2] };
}

export function SavePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const url = params.get("url") ?? "";
  const text = params.get("text") ?? "";
  const title = params.get("title") ?? undefined;

  useEffect(() => {
    if (loading) return;

    if (!user) {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      navigate(`/login?redirect=${redirect}`, { replace: true });
      return;
    }

    if (status !== "idle") return;

    const tweet = parseTweetUrl(url);
    if (!tweet) {
      setErrorMsg("Only tweet URLs are supported right now.");
      setStatus("error");
      return;
    }

    setStatus("saving");
    addClip({
      sourceType: "tweet",
      sourceUrl: url,
      content: text || undefined,
      author: tweet.author,
      title,
      sourceMetadata: { tweetId: tweet.tweetId },
    })
      .then(() => setStatus("done"))
      .catch((err: Error) => {
        setErrorMsg(err.message);
        setStatus("error");
      });
  }, [loading, user, status]);

  if (loading || status === "saving") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-gray-500">Saving to Cliphy…</p>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <p className="text-sm font-medium">Saved to Cliphy</p>
        <a href="/dashboard" className="text-sm text-blue-600 underline">
          View your clips
        </a>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <p className="text-sm text-red-600">{errorMsg}</p>
        <a href="/dashboard" className="text-sm text-blue-600 underline">
          Go to dashboard
        </a>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 3: Register `/save` route in `apps/web/src/main.tsx`**

Add import:

```typescript
import { SavePage } from "./pages/SavePage";
```

Add route inside `<Routes>`, after the `/login` route and before the `<Route element={<ProtectedRoute />}>` block:

```tsx
<Route path="/save" element={<SavePage />} />
```

The final `<Routes>` block should look like:

```tsx
<Routes>
  <Route path="/" element={<Landing />} />
  <Route path="/login" element={<Login />} />
  <Route path="/save" element={<SavePage />} />
  <Route element={<ProtectedRoute />}>
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/summary/:id" element={<SummaryPage />} />
    <Route path="/subscriptions" element={<Subscriptions />} />
  </Route>
</Routes>
```

- [ ] **Step 4: Test the /save page in the browser**

```bash
pnpm dev
```

Open: `http://localhost:5173/save?url=https://x.com/user/status/123&text=Test+tweet&title=User`

Expected behavior:
- If not logged in: redirects to `/login`
- If logged in: shows "Saving to Cliphy…" → then "Saved to Cliphy" with a link to dashboard
- Check the `clips` table in Supabase dashboard to confirm the row was inserted

- [ ] **Step 5: TypeScript check**

```bash
pnpm --filter=web build
```

Expected: clean build with no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/SavePage.tsx apps/web/src/lib/api.ts apps/web/src/main.tsx
git commit -m "add /save Web Share Target page and addClip API call"
```

---

## Testing the full flow end-to-end

After all tasks are complete:

1. On an Android device, open Chrome and visit `cliphy.app`
2. Tap the browser menu → "Add to Home Screen" → install Cliphy as a PWA
3. Open the X/Twitter app, find any tweet, tap Share
4. "Cliphy" should appear in the share sheet
5. Tap it — Chrome opens `cliphy.app/save?url=...&text=...`
6. If logged in: clip saves automatically, "Saved to Cliphy" appears
7. Verify in Supabase: the `clips` table has a new row with `source_type = 'tweet'`
8. Within a few seconds: the `embedding` column should populate (check via Supabase SQL editor)

For iOS: the PWA must be installed via Safari (Add to Home Screen) for share sheet registration to work.
