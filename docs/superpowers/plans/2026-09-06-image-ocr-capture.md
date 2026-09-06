# Image / Screenshot OCR Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture images (photo library, camera, share sheet) into Cliphy, run Claude vision to OCR text / describe / detect tweets, store the original in Supabase Storage, and surface each as an enriched clip in the unified inbox.

**Architecture:** Mobile downscales + uploads the image directly to a private Supabase Storage bucket, then POSTs the storage path to `/api/clips`. The server creates an `image` clip and fires `clip/vision.requested`; the `visionClip` Inngest worker reads the image, runs Claude vision (with tiling for tall images and a tweet re-fetch path), writes `content` + `source_metadata`, and fires `clip/embed.requested` — reusing subproject #1's enrichment + embedding + inbox.

**Tech Stack:** Hono + Supabase (Storage + Postgres) + Inngest, Claude vision (`claude-sonnet-4-6`, base64 image blocks), Vitest v4 (run from repo root: `pnpm vitest run <path>`), React Native + Expo (`expo-image-picker`, `expo-image-manipulator`), NativeWind.

## Global Constraints

- Server relative imports MUST use the `.js` extension (NodeNext ESM). Mobile imports are extensionless.
- DB table is `clips`; `toClip(row)` in `apps/server/src/lib/mappers.ts` is the only row→API mapper. It already maps `sourceType`, `sourceMetadata`, `heroImageUrl`, `excerpt`, `category` generically.
- Inngest functions use `{ id, retries, triggers: [{ event: "..." }] }` and must be imported AND added to the `serve({ functions: [...] })` array in `apps/server/src/app.ts`.
- Service-role client: `import { supabase } from "../lib/supabase.js"` (bypasses RLS, for workers). Mobile uses the anon client `import { supabase } from "../lib/supabase"` (has the user session).
- Anthropic client: `new Anthropic({ timeout: N })`, model constant a string; `ANTHROPIC_API_KEY` comes from env. Image content blocks are new: `content: [{ type: "text", text }, { type: "image", source: { type: "base64", media_type, data } }]`.
- Tests run from repo root: `pnpm vitest run <path>` (single: add `-t "<name>"`). Every suite tags Allure in `beforeEach`: `layer("unit"); epic(...); feature(...);` from `allure-js-commons`.
- Migrations live in `apps/server/supabase/migrations/`, applied via `pnpm --filter server migrate` (needs `DATABASE_URL` in `apps/server/.env.local`, deleted after). SQL style: lowercase keywords, `public.` prefix, RLS `to authenticated ... using ((select auth.uid()) = ...)`.
- Commit messages: imperative mood, end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Reuse the existing `clip/embed.requested` pipeline; do not duplicate enrichment/embedding.

## File Structure

**Shared (`packages/shared/src/`)**

- `types.ts` — `SourceType` += `"image"`; add `ImageClipMetadata`.
- `constants.ts` — `SOURCE_TYPES.IMAGE`.

**Server (`apps/server/src/`)**

- `services/vision.ts` — `parseVisionResult`, `shouldTile`, `mergeTiles`, `analyzeImage` (new).
- `services/tiling.ts` — `tileImage(bytes) → Buffer[]` via `sharp` (new).
- `functions/visionClip.ts` — Inngest worker (new).
- `lib/storage.ts` — `signImageUrl(path)`, `downloadImage(path)` (new).
- `routes/clips.ts` — add `imagePath` branch + sign image clips on read (modify).
- `functions/embed-clip.ts` — include `"image"` in the enrichment condition (modify).
- `app.ts` — import + register `visionClip` (modify).
- `supabase/migrations/025_image_clips.sql` — source_type constraint + bucket + RLS (new).

**Mobile (`apps/mobile/`)**

- `lib/uploadImage.ts` — downscale + upload + `addClip({imagePath})` (new).
- `lib/api.ts` — widen `addClip` body (modify).
- `components/CaptureSheet.tsx` — library/camera action sheet (new).
- `components/ImageCard.tsx` — inbox card (new).
- `components/ClipCard.tsx` — dispatch `image` → `ImageCard` (modify).
- `app/(tabs)/index.tsx` — "+" opens `CaptureSheet` (modify).
- `app/_layout.tsx` — share-intent image branch (modify).
- `app/summary/[id].tsx` — generalize header for image clips (modify).
- `app.json` — expo-share-intent image rules + new plugins (modify).

---

### Task 1: Shared types & constant for `image`

**Files:**

- Modify: `packages/shared/src/types.ts` (SourceType line 55)
- Modify: `packages/shared/src/constants.ts` (SOURCE_TYPES)
- Test: `packages/shared/src/__tests__/image-clip-types.test.ts` (create)

**Interfaces:**

- Produces: `SourceType` includes `"image"`; `SOURCE_TYPES.IMAGE = "image"`; `ImageClipMetadata` interface.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/image-clip-types.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { SOURCE_TYPES } from "../constants";

describe("image source type", () => {
  beforeEach(() => {
    layer("unit");
    epic("Data");
    feature("Image Clip Types");
  });

  it("SOURCE_TYPES exposes image", () => {
    expect(SOURCE_TYPES.IMAGE).toBe("image");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/src/__tests__/image-clip-types.test.ts`
Expected: FAIL — `SOURCE_TYPES.IMAGE` is undefined.

- [ ] **Step 3: Add the constant**

In `packages/shared/src/constants.ts`, add `IMAGE: "image",` to the `SOURCE_TYPES` object (after `WEB: "web",`).

- [ ] **Step 4: Extend the types**

In `packages/shared/src/types.ts` replace the `SourceType` line with:

```typescript
export type SourceType = "youtube" | "tweet" | "podcast" | "web" | "image";
```

Then add after the `WebClipMetadata` interface:

```typescript
export interface ImageClipMetadata {
  kind: "text" | "visual";
  storagePath: string;
  width?: number;
  height?: number;
  tiled?: boolean;
  partial?: boolean;
  detectedTweetUrl?: string;
  tweet?: { handle: string; author: string; text: string };
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm vitest run packages/shared/src/__tests__/image-clip-types.test.ts` → PASS
Run: `pnpm --filter shared typecheck` → no errors

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/constants.ts packages/shared/src/__tests__/image-clip-types.test.ts
git commit -m "add image source type and ImageClipMetadata

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Migration — source_type constraint + Storage bucket + RLS

**Files:**

- Create: `apps/server/supabase/migrations/025_image_clips.sql`
- Test: `apps/server/src/lib/__tests__/mappers.test.ts` (add an image-row case)

**Interfaces:**

- Produces: DB accepts `source_type = 'image'`; private bucket `clip-images` with per-user RLS.

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/lib/__tests__/mappers.test.ts` inside the `describe("toClip", ...)` block:

```typescript
it("maps an image clip row", () => {
  const row = {
    id: "img1",
    user_id: "u1",
    source_type: "image",
    hero_image_url: "u1/abc.jpg",
    content: "extracted text",
    excerpt: "extracted text",
    status: "completed",
    source_metadata: { kind: "text", storagePath: "u1/abc.jpg" },
    tags: [],
    created_at: "2026-09-06T00:00:00Z",
    updated_at: "2026-09-06T00:00:00Z",
  };
  const clip = toClip(row);
  expect(clip.sourceType).toBe("image");
  expect(clip.heroImageUrl).toBe("u1/abc.jpg");
  expect(clip.sourceMetadata).toEqual({ kind: "text", storagePath: "u1/abc.jpg" });
});
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

Run: `pnpm vitest run apps/server/src/lib/__tests__/mappers.test.ts -t "image clip row"`
Expected: PASS (`toClip` already maps these generically). This locks the mapping contract the migration relies on.

- [ ] **Step 3: Write the migration**

Create `apps/server/supabase/migrations/025_image_clips.sql`:

```sql
-- apps/server/supabase/migrations/025_image_clips.sql
-- Image / screenshot capture: allow the `image` source type and add a private
-- Storage bucket for captured images with per-user RLS.

-- Extend the source_type check constraint to include 'image'.
alter table public.clips drop constraint if exists clips_source_type_check;
alter table public.clips
  add constraint clips_source_type_check
  check (source_type in ('youtube', 'tweet', 'podcast', 'web', 'image'));

-- Private bucket for captured images.
insert into storage.buckets (id, name, public)
values ('clip-images', 'clip-images', false)
on conflict (id) do nothing;

-- RLS: a user may read/write/delete only under their own <userId>/ folder.
-- storage.foldername(name)[1] is the first path segment (the user id).
create policy "clip_images_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'clip-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "clip_images_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'clip-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "clip_images_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'clip-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
```

- [ ] **Step 4: Apply the migration**

```bash
echo "DATABASE_URL=<session-pooler-url>" > apps/server/.env.local
pnpm --filter server migrate
rm apps/server/.env.local
```

Expected: `applying 025_image_clips.sql … ✓`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/supabase/migrations/025_image_clips.sql apps/server/src/lib/__tests__/mappers.test.ts
git commit -m "add image source type constraint and clip-images storage bucket

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Vision pure helpers (`parseVisionResult`, `shouldTile`, `mergeTiles`)

**Files:**

- Create: `apps/server/src/services/vision.ts` (helpers only in this task)
- Test: `apps/server/src/services/__tests__/vision.test.ts` (create)

**Interfaces:**

- Produces:

```typescript
export interface VisionResult {
  kind: "text" | "visual";
  extractedText: string;
  description: string;
  detectedTweetUrl?: string;
  reconstructedTweet?: { handle: string; author: string; text: string };
  partial?: boolean;
}
export function parseVisionResult(raw: string): VisionResult;
export function shouldTile(width: number, height: number): boolean;
export function mergeTiles(results: VisionResult[]): VisionResult;
```

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/services/__tests__/vision.test.ts`:

````typescript
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { parseVisionResult, shouldTile, mergeTiles } from "../vision.js";

describe("vision helpers", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Vision");
  });

  it("parses fenced JSON into a VisionResult", () => {
    const raw =
      '```json\n{"kind":"text","extractedText":"hello","description":"a note","detectedTweetUrl":"https://x.com/a/status/1"}\n```';
    const r = parseVisionResult(raw);
    expect(r.kind).toBe("text");
    expect(r.extractedText).toBe("hello");
    expect(r.description).toBe("a note");
    expect(r.detectedTweetUrl).toBe("https://x.com/a/status/1");
  });

  it("defaults to visual on unparseable input", () => {
    const r = parseVisionResult("not json");
    expect(r.kind).toBe("visual");
    expect(r.extractedText).toBe("");
  });

  it("tiles only tall images (height/width > 4)", () => {
    expect(shouldTile(1000, 5000)).toBe(true);
    expect(shouldTile(1000, 3000)).toBe(false);
    expect(shouldTile(1000, 1000)).toBe(false);
  });

  it("merges tiles: concatenates text, keeps first tweet, flags partial", () => {
    const merged = mergeTiles([
      {
        kind: "text",
        extractedText: "line one",
        description: "top",
        detectedTweetUrl: "https://x.com/a/status/1",
      },
      { kind: "text", extractedText: "line two", description: "bottom", partial: true },
    ]);
    expect(merged.kind).toBe("text");
    expect(merged.extractedText).toBe("line one\nline two");
    expect(merged.detectedTweetUrl).toBe("https://x.com/a/status/1");
    expect(merged.partial).toBe(true);
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/services/__tests__/vision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helpers**

Create `apps/server/src/services/vision.ts`:

````typescript
export interface VisionResult {
  kind: "text" | "visual";
  extractedText: string;
  description: string;
  detectedTweetUrl?: string;
  reconstructedTweet?: { handle: string; author: string; text: string };
  partial?: boolean;
}

const TALL_RATIO = 4;

export function shouldTile(width: number, height: number): boolean {
  if (!width || !height) return false;
  return height / width > TALL_RATIO;
}

export function parseVisionResult(raw: string): VisionResult {
  const jsonText = raw.replace(/```json\s*|\s*```/g, "").trim();
  let p: Partial<VisionResult> = {};
  try {
    p = JSON.parse(jsonText);
  } catch {
    p = {};
  }
  const kind = p.kind === "text" ? "text" : "visual";
  return {
    kind,
    extractedText: typeof p.extractedText === "string" ? p.extractedText : "",
    description: typeof p.description === "string" ? p.description : "",
    detectedTweetUrl: p.detectedTweetUrl,
    reconstructedTweet: p.reconstructedTweet,
  };
}

export function mergeTiles(results: VisionResult[]): VisionResult {
  const text = results
    .map((r) => r.extractedText)
    .filter(Boolean)
    .join("\n");
  const description = results
    .map((r) => r.description)
    .filter(Boolean)
    .join(" ");
  const tweetUrl = results.find((r) => r.detectedTweetUrl)?.detectedTweetUrl;
  const tweet = results.find((r) => r.reconstructedTweet)?.reconstructedTweet;
  const anyText = results.some((r) => r.kind === "text");
  return {
    kind: anyText ? "text" : "visual",
    extractedText: text,
    description,
    detectedTweetUrl: tweetUrl,
    reconstructedTweet: tweet,
    partial: results.some((r) => r.partial) || undefined,
  };
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/server/src/services/__tests__/vision.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/vision.ts apps/server/src/services/__tests__/vision.test.ts
git commit -m "add vision result parsing, tiling threshold, and tile merge helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `analyzeImage` (Claude vision call)

**Files:**

- Modify: `apps/server/src/services/vision.ts` (add `analyzeImage`)
- Test: `apps/server/src/services/__tests__/vision-analyze.test.ts` (create)

**Interfaces:**

- Consumes: `parseVisionResult` (Task 3).
- Produces: `export async function analyzeImage(imageBytes: Buffer, mediaType: string): Promise<VisionResult>`.

- [ ] **Step 1: Write the failing test (mock the Anthropic SDK)**

Create `apps/server/src/services/__tests__/vision-analyze.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

const { analyzeImage } = await import("../vision.js");

describe("analyzeImage", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Vision");
    createMock.mockReset();
  });

  it("sends an image block and parses the JSON reply", async () => {
    createMock.mockResolvedValue({
      content: [
        { type: "text", text: '{"kind":"visual","extractedText":"","description":"a chart"}' },
      ],
    });
    const result = await analyzeImage(Buffer.from("fake"), "image/jpeg");
    expect(result.kind).toBe("visual");
    expect(result.description).toBe("a chart");

    const arg = createMock.mock.calls[0][0];
    const blocks = arg.messages[0].content;
    expect(blocks.some((b: { type: string }) => b.type === "image")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/services/__tests__/vision-analyze.test.ts`
Expected: FAIL — `analyzeImage` is not exported.

- [ ] **Step 3: Implement `analyzeImage`**

Append to `apps/server/src/services/vision.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ timeout: 60_000 });
const VISION_MODEL = "claude-sonnet-4-6";

const VISION_PROMPT =
  `Analyze this image. Return ONLY JSON: {` +
  `"kind": "text" if the image is dominated by readable text (screenshot, tweet, ` +
  `article, label, receipt) else "visual", ` +
  `"extractedText": all readable text verbatim (empty string if kind is visual), ` +
  `"description": one-sentence description of what the image is, ` +
  `"detectedTweetUrl": a visible tweet URL like https://x.com/user/status/123 or omit, ` +
  `"reconstructedTweet": {"handle","author","text"} if this is clearly a tweet/thread, else omit}.`;

export async function analyzeImage(imageBytes: Buffer, mediaType: string): Promise<VisionResult> {
  const res = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: VISION_PROMPT },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
              data: imageBytes.toString("base64"),
            },
          },
        ],
      },
    ],
  });
  const text = res.content.map((b) => ("text" in b ? b.text : "")).join("");
  return parseVisionResult(text);
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run apps/server/src/services/__tests__/vision-analyze.test.ts` → PASS
Run: `pnpm --filter server typecheck` → no errors

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/vision.ts apps/server/src/services/__tests__/vision-analyze.test.ts
git commit -m "add analyzeImage Claude vision call

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Storage helpers + image tiling

**Files:**

- Create: `apps/server/src/lib/storage.ts`
- Create: `apps/server/src/services/tiling.ts`
- Modify: `apps/server/package.json` (add `sharp`)
- Test: `apps/server/src/services/__tests__/tiling.test.ts` (create)

**Interfaces:**

- Produces:
  - `storage.ts`: `export async function downloadImage(path: string): Promise<{ bytes: Buffer; mediaType: string }>`; `export async function signImageUrl(path: string): Promise<string | null>`.
  - `tiling.ts`: `export async function tileImage(bytes: Buffer, tileHeight?: number): Promise<Buffer[]>`; `export async function imageSize(bytes: Buffer): Promise<{ width: number; height: number }>`.

- [ ] **Step 1: Add `sharp`**

```bash
pnpm --filter server add sharp
```

Expected: `sharp` under `apps/server/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/services/__tests__/tiling.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import sharp from "sharp";
import { tileImage, imageSize } from "../tiling.js";

async function makeImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

describe("tiling", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Tiling");
  });

  it("reports image size", async () => {
    const buf = await makeImage(300, 900);
    expect(await imageSize(buf)).toEqual({ width: 300, height: 900 });
  });

  it("splits a tall image into multiple tiles", async () => {
    const buf = await makeImage(300, 2400);
    const tiles = await tileImage(buf, 1000);
    expect(tiles.length).toBeGreaterThan(1);
    const first = await imageSize(tiles[0]);
    expect(first.width).toBe(300);
  });

  it("returns a single tile for a short image", async () => {
    const buf = await makeImage(300, 600);
    const tiles = await tileImage(buf, 1000);
    expect(tiles.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/services/__tests__/tiling.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement tiling**

Create `apps/server/src/services/tiling.ts`:

```typescript
import sharp from "sharp";

export async function imageSize(bytes: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

// Split a tall image into vertical tiles of at most `tileHeight` px, with a
// small overlap so text spanning a cut isn't lost. Returns a single tile when
// the image is short enough.
export async function tileImage(bytes: Buffer, tileHeight = 1500): Promise<Buffer[]> {
  const { width, height } = await imageSize(bytes);
  if (!width || !height || height <= tileHeight) return [bytes];

  const overlap = 100;
  const tiles: Buffer[] = [];
  let top = 0;
  while (top < height) {
    const h = Math.min(tileHeight, height - top);
    const tile = await sharp(bytes).extract({ left: 0, top, width, height: h }).jpeg().toBuffer();
    tiles.push(tile);
    if (top + h >= height) break;
    top += tileHeight - overlap;
  }
  return tiles;
}
```

- [ ] **Step 5: Implement storage helpers**

Create `apps/server/src/lib/storage.ts`:

```typescript
import { supabase } from "./supabase.js";

const BUCKET = "clip-images";

function mediaTypeFor(path: string): string {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function downloadImage(path: string): Promise<{ bytes: Buffer; mediaType: string }> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Failed to download image ${path}: ${error?.message}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  return { bytes, mediaType: mediaTypeFor(path) };
}

export async function signImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}
```

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm vitest run apps/server/src/services/__tests__/tiling.test.ts` → PASS
Run: `pnpm --filter server typecheck` → no errors

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/lib/storage.ts apps/server/src/services/tiling.ts apps/server/src/services/__tests__/tiling.test.ts apps/server/package.json pnpm-lock.yaml
git commit -m "add storage download/sign helpers and sharp-based image tiling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `visionClip` Inngest worker + enrichment wiring

**Files:**

- Create: `apps/server/src/functions/visionClip.ts`
- Modify: `apps/server/src/app.ts` (import + register)
- Modify: `apps/server/src/functions/embed-clip.ts` (include `"image"` in enrichment condition)
- Test: `apps/server/src/functions/__tests__/visionClip.test.ts` (create)

**Interfaces:**

- Consumes: `downloadImage`, `imageSize`, `shouldTile`, `tileImage`, `analyzeImage`, `mergeTiles`, `extractTweetClip` (Task 5 of subproject #1).
- Produces: `export const visionClip` triggered by `clip/vision.requested` `{ clipId: string }`; on success writes `content`/`excerpt`/`source_metadata`/`status`, then fires `clip/embed.requested`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/functions/__tests__/visionClip.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const updateEq = vi.fn().mockResolvedValue({ error: null });
const fromMock = vi.fn(() => ({
  select: () => ({
    eq: () => ({
      single: () => ({
        data: {
          id: "c1",
          user_id: "u1",
          hero_image_url: "u1/a.jpg",
          source_metadata: { storagePath: "u1/a.jpg" },
        },
        error: null,
      }),
    }),
  }),
  update: () => ({ eq: updateEq }),
}));
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: fromMock } }));
const sendMock = vi.fn();
vi.mock("../../lib/inngest.js", () => ({
  inngest: { createFunction: (_c: unknown, fn: unknown) => fn, send: sendMock },
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) },
}));
vi.mock("../../lib/storage.js", () => ({
  downloadImage: vi.fn(async () => ({ bytes: Buffer.from("x"), mediaType: "image/jpeg" })),
}));
vi.mock("../../services/tiling.js", () => ({
  imageSize: vi.fn(async () => ({ width: 800, height: 600 })),
  tileImage: vi.fn(async (b: Buffer) => [b]),
}));
vi.mock("../../services/vision.js", () => ({
  shouldTile: vi.fn(() => false),
  mergeTiles: (r: unknown[]) => r[0],
  analyzeImage: vi.fn(async () => ({
    kind: "text",
    extractedText: "hello world",
    description: "a note",
  })),
}));
vi.mock("../../services/extractors/tweet.js", () => ({ extractTweetClip: vi.fn() }));

const { visionClip } = await import("../visionClip.js");
const { inngest } = await import("../../lib/inngest.js");

function runStep() {
  return { run: async (_n: string, fn: () => Promise<unknown>) => fn() };
}

describe("visionClip worker", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Vision Worker");
    vi.clearAllMocks();
  });

  it("analyzes the image, writes content, and fires embed", async () => {
    await (visionClip as unknown as (a: unknown) => Promise<unknown>)({
      event: { data: { clipId: "c1" } },
      step: runStep(),
    });
    expect(updateEq).toHaveBeenCalled();
    expect(inngest.send).toHaveBeenCalledWith({
      name: "clip/embed.requested",
      data: { clipId: "c1" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/functions/__tests__/visionClip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the worker**

Create `apps/server/src/functions/visionClip.ts`:

```typescript
import { inngest } from "../lib/inngest.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { downloadImage } from "../lib/storage.js";
import { imageSize, tileImage } from "../services/tiling.js";
import { shouldTile, mergeTiles, analyzeImage, type VisionResult } from "../services/vision.js";
import { extractTweetClip } from "../services/extractors/tweet.js";

const log = logger.child({ fn: "vision-clip" });

export const visionClip = inngest.createFunction(
  { id: "vision-clip", retries: 2, triggers: [{ event: "clip/vision.requested" }] },
  async ({ event, step }) => {
    const { clipId } = event.data as { clipId: string };

    const clip = await step.run("fetch-clip", async () => {
      const { data, error } = await supabase
        .from("clips")
        .select("id, user_id, hero_image_url, source_metadata")
        .eq("id", clipId)
        .single();
      if (error || !data) throw new Error(`Vision: clip ${clipId} not found: ${error?.message}`);
      return data as {
        id: string;
        user_id: string;
        hero_image_url: string;
        source_metadata: { storagePath?: string } | null;
      };
    });

    const storagePath = clip.source_metadata?.storagePath ?? clip.hero_image_url;

    const vision = await step.run(
      "analyze",
      async (): Promise<VisionResult & { width: number; height: number }> => {
        try {
          const { bytes, mediaType } = await downloadImage(storagePath);
          const { width, height } = await imageSize(bytes);
          const tiles = shouldTile(width, height) ? await tileImage(bytes) : [bytes];
          const results: VisionResult[] = [];
          for (const tile of tiles) {
            try {
              results.push(await analyzeImage(tile, mediaType));
            } catch {
              results.push({ kind: "visual", extractedText: "", description: "", partial: true });
            }
          }
          return { ...mergeTiles(results), width, height };
        } catch (err) {
          throw new Error(`Vision analysis failed for ${clipId}: ${(err as Error).message}`);
        }
      },
    );

    // If a real tweet URL is visible, prefer the full-fidelity extractor.
    let tweet = vision.reconstructedTweet
      ? {
          handle: vision.reconstructedTweet.handle,
          author: vision.reconstructedTweet.author,
          text: vision.reconstructedTweet.text,
        }
      : undefined;
    if (vision.detectedTweetUrl) {
      const fetched = await step.run("refetch-tweet", async () => {
        try {
          const tw = await extractTweetClip(vision.detectedTweetUrl!);
          return { handle: tw.author.handle, author: tw.author.name, text: tw.text };
        } catch {
          return null;
        }
      });
      if (fetched) tweet = fetched;
    }

    await step.run("write-result", async () => {
      const isText = vision.kind === "text" || Boolean(tweet);
      const content = tweet?.text || (isText ? vision.extractedText : vision.description);
      const excerpt = (content || vision.description).slice(0, 200);
      const { error } = await supabase
        .from("clips")
        .update({
          content: content || null,
          excerpt: excerpt || null,
          status: "completed",
          source_metadata: {
            ...(clip.source_metadata ?? {}),
            kind: isText ? "text" : "visual",
            storagePath,
            width: vision.width,
            height: vision.height,
            tiled: shouldTile(vision.width, vision.height),
            partial: vision.partial,
            detectedTweetUrl: vision.detectedTweetUrl,
            tweet,
          },
        })
        .eq("id", clipId);
      if (error) throw new Error(`Failed to write vision result for ${clipId}: ${error.message}`);
    });

    await step.run("request-embed", async () => {
      await inngest.send({ name: "clip/embed.requested", data: { clipId } });
    });

    log.info("Vision clip complete", { clipId });
    return { clipId, status: "completed" };
  },
);
```

- [ ] **Step 4: Register the worker**

In `apps/server/src/app.ts`: add `import { visionClip } from "./functions/visionClip.js";` alongside the other function imports, and add `visionClip,` to the `serve({ functions: [...] })` array.

- [ ] **Step 5: Include `image` in enrichment**

In `apps/server/src/functions/embed-clip.ts`, change the enrichment condition and the `enrichClip` sourceType cast to include `image`:

```typescript
    if (
      (clip.source_type === "web" || clip.source_type === "tweet" || clip.source_type === "image") &&
      !clip.summary_json
    ) {
      const enrichment = await step.run("enrich-clip", async () => {
        const e = await enrichClip({
          sourceType: clip.source_type as "web" | "tweet" | "image",
          title: clip.video_title ?? undefined,
          text: clip.content ?? "",
        });
```

(`enrichClip`'s `EnrichInput.sourceType` is typed `SourceType`, which now includes `"image"`, so no change needed in `enrich.ts`.)

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm vitest run apps/server/src/functions/__tests__/visionClip.test.ts` → PASS
Run: `pnpm --filter server typecheck` → no errors

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/functions/visionClip.ts apps/server/src/app.ts apps/server/src/functions/embed-clip.ts apps/server/src/functions/__tests__/visionClip.test.ts
git commit -m "add visionClip worker: OCR/describe images, tweet re-fetch, fire enrichment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `/api/clips` image branch + signed-URL read resolution

**Files:**

- Modify: `apps/server/src/routes/clips.ts`
- Test: `apps/server/src/routes/__tests__/clips-image.test.ts` (create)

**Interfaces:**

- Consumes: `signImageUrl` (Task 5).
- Produces: `POST /api/clips` accepts `{ imagePath }` → creates an `image` clip (status `pending`, `hero_image_url = imagePath`, `source_metadata.storagePath = imagePath`), fires `clip/vision.requested`, returns `{ clip }` with `heroImageUrl` resolved to a signed URL.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/routes/__tests__/clips-image.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";

function mockChain(result: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "insert", "update", "eq", "is", "maybeSingle", "single"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  (chain as { then: unknown }).then = (r: (x: unknown) => void) => r(result);
  return chain;
}
let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    {
      get: (_, p) =>
        p === "from"
          ? (...a: unknown[]) => (supabaseMock.from as (...x: unknown[]) => unknown)(...a)
          : undefined,
    },
  ),
}));
vi.mock("../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "u1");
      await next();
    },
  ),
}));
vi.mock("../../services/detectSourceType.js", () => ({ detectSourceType: vi.fn() }));
vi.mock("../../services/extractors/web.js", () => ({ extractWebClip: vi.fn() }));
vi.mock("../../services/extractors/tweet.js", () => ({ extractTweetClip: vi.fn() }));
vi.mock("../../lib/storage.js", () => ({
  signImageUrl: vi.fn(async () => "https://signed.example/a.jpg"),
}));

const { clipsRoutes } = await import("../clips.js");
const { inngest } = await import("../../lib/inngest.js");

describe("POST /clips image branch", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Clips API");
    vi.clearAllMocks();
  });

  it("creates an image clip, fires vision, returns signed hero url", async () => {
    supabaseMock = {
      from: vi
        .fn()
        .mockReturnValueOnce(mockChain({ data: null }))
        .mockReturnValueOnce(
          mockChain({
            data: {
              id: "c1",
              source_type: "image",
              hero_image_url: "u1/a.jpg",
              status: "pending",
              tags: [],
              created_at: "t",
              updated_at: "t",
            },
            error: null,
          }),
        ),
    };
    const app = new Hono();
    app.route("/clips", clipsRoutes);
    const res = await app.request("/clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imagePath: "u1/a.jpg" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.clip.sourceType).toBe("image");
    expect(json.clip.heroImageUrl).toBe("https://signed.example/a.jpg");
    expect(inngest.send).toHaveBeenCalledWith({
      name: "clip/vision.requested",
      data: { clipId: "c1" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/routes/__tests__/clips-image.test.ts`
Expected: FAIL — no `imagePath` branch yet (body requires `url`, returns 400).

- [ ] **Step 3: Implement the image branch**

In `apps/server/src/routes/clips.ts`: add the storage import, widen the body type, and add the image branch above the URL logic. Replace the imports + handler top:

```typescript
import { signImageUrl } from "../lib/storage.js";
```

Change the body read + guard:

```typescript
const body = await c.req.json<{ url?: string; imagePath?: string }>();

// Image capture: no URL to classify — create an image clip and hand off to
// the vision worker.
if (body.imagePath) {
  const { data: row, error } = await supabase
    .from("clips")
    .insert({
      user_id: userId,
      source_type: "image",
      hero_image_url: body.imagePath,
      source_metadata: { storagePath: body.imagePath },
      status: "pending",
      tags: [],
    })
    .select("*")
    .single();
  if (error || !row) return c.json({ error: "Failed to save clip" }, 500);
  await inngest.send({ name: "clip/vision.requested", data: { clipId: row.id } });
  const clip = toClip(row);
  clip.heroImageUrl = (await signImageUrl(body.imagePath)) ?? clip.heroImageUrl;
  return c.json({ clip }, 201);
}

if (!body.url) return c.json({ error: "url is required" }, 400);
```

- [ ] **Step 4: Resolve signed URLs when returning image clips elsewhere**

Add a helper at the bottom of `clips.ts` and note it's used by list/read paths in `summaries.ts` (documented for Task 9 consumers). For this task, ensure the POST response signs (done above). Add the exported helper:

```typescript
export async function resolveClipImage<T extends { sourceType: string; heroImageUrl?: string }>(
  clip: T,
): Promise<T> {
  if (clip.sourceType === "image" && clip.heroImageUrl) {
    clip.heroImageUrl = (await signImageUrl(clip.heroImageUrl)) ?? clip.heroImageUrl;
  }
  return clip;
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm vitest run apps/server/src/routes/__tests__/clips-image.test.ts` → PASS
Run: `pnpm --filter server typecheck` → no errors

- [ ] **Step 6: Wire signed URLs into the clip list/read**

In `apps/server/src/routes/summaries.ts`, find the GET list and GET `:id` handlers that return clips via `toClip`, and map each image clip through `resolveClipImage` before responding (import it from `./clips.js`). Concretely, after building the array/object of mapped clips:

```typescript
import { resolveClipImage } from "./clips.js";
// list: const clips = await Promise.all(rows.map((r) => resolveClipImage(toClip(r))));
// single: const clip = await resolveClipImage(toClip(row));
```

Run: `pnpm --filter server typecheck` → no errors. Then run the existing summaries tests: `pnpm vitest run apps/server/src/routes/__tests__/summaries.test.ts` (if present) → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/routes/clips.ts apps/server/src/routes/summaries.ts apps/server/src/routes/__tests__/clips-image.test.ts
git commit -m "accept image clips at POST /api/clips and sign image urls on read

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Mobile image upload helper + `addClip` widening

**Files:**

- Create: `apps/mobile/lib/uploadImage.ts`
- Modify: `apps/mobile/lib/api.ts` (`addClip` body type)
- Modify: `apps/mobile/package.json` (`expo-image-picker`, `expo-image-manipulator`)
- Test: `apps/mobile/lib/__tests__/uploadImage.test.ts` (create)

**Interfaces:**

- Consumes: `addClip` (widened), mobile `supabase` client.
- Produces: `export async function uploadAndClipImage(localUri: string): Promise<Summary>`; `export function storagePathFor(userId: string, uri: string): string`.

- [ ] **Step 1: Add deps**

```bash
cd apps/mobile && npx expo install expo-image-picker expo-image-manipulator && cd ../..
```

Expected: both appear in `apps/mobile/package.json`.

- [ ] **Step 2: Widen `addClip`**

In `apps/mobile/lib/api.ts` change `addClip`:

```typescript
export const addClip = (body: { url?: string; imagePath?: string }) =>
  apiFetch<{ clip: Summary }>("/api/clips", {
    method: "POST",
    body: JSON.stringify(body),
  });
```

- [ ] **Step 3: Write the failing test (pure path helper)**

Create `apps/mobile/lib/__tests__/uploadImage.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { storagePathFor } from "../uploadImage";

describe("storagePathFor", () => {
  beforeEach(() => {
    layer("unit");
    epic("Capture");
    feature("Upload");
  });

  it("namespaces the path under the user id and keeps a jpg extension", () => {
    const p = storagePathFor("user-123", "file:///tmp/whatever.HEIC");
    expect(p.startsWith("user-123/")).toBe(true);
    expect(p.endsWith(".jpg")).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run apps/mobile/lib/__tests__/uploadImage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the helper**

Create `apps/mobile/lib/uploadImage.ts`:

```typescript
import * as ImageManipulator from "expo-image-manipulator";
import type { Summary } from "@cliphy/shared";
import { supabase } from "./supabase";
import { addClip } from "./api";

const BUCKET = "clip-images";

// A stable-enough unique id without pulling in a uuid dep.
function uid(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function storagePathFor(userId: string, _uri: string): string {
  return `${userId}/${uid()}.jpg`;
}

export async function uploadAndClipImage(localUri: string): Promise<Summary> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in");

  // Downscale + recompress to keep uploads small and within Claude vision limits.
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 2000 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );

  const path = storagePathFor(userId, localUri);
  const res = await fetch(manipulated.uri);
  const arrayBuffer = await res.arrayBuffer();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { clip } = await addClip({ imagePath: path });
  return clip;
}
```

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm vitest run apps/mobile/lib/__tests__/uploadImage.test.ts` → PASS
Run: `pnpm --filter mobile typecheck` → no errors

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/lib/uploadImage.ts apps/mobile/lib/api.ts apps/mobile/lib/__tests__/uploadImage.test.ts apps/mobile/package.json pnpm-lock.yaml
git commit -m "mobile: image downscale + storage upload + addClip(imagePath) helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Mobile capture UI, ImageCard, share-intent, detail generalization

**Files:**

- Create: `apps/mobile/components/CaptureSheet.tsx`
- Create: `apps/mobile/components/ImageCard.tsx`
- Modify: `apps/mobile/components/ClipCard.tsx`
- Modify: `apps/mobile/app/(tabs)/index.tsx`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/summary/[id].tsx`
- Modify: `apps/mobile/app.json`

**Interfaces:**

- Consumes: `uploadAndClipImage` (Task 8), `ImageClipMetadata`, `expo-image-picker`.
- Produces: capture entry points + `image` rendering.

- [ ] **Step 1: `app.json` — enable image share + register plugins**

In `apps/mobile/app.json`, update the `expo-share-intent` entry and add the two new config plugins:

```json
      [
        "expo-share-intent",
        {
          "iosActivationRules": {
            "NSExtensionActivationSupportsWebURLWithMaxCount": 1,
            "NSExtensionActivationSupportsImageWithMaxCount": 1
          },
          "androidIntentFilters": ["text/*", "image/*"]
        }
      ],
      "expo-image-picker"
```

- [ ] **Step 2: `ImageCard`**

Create `apps/mobile/components/ImageCard.tsx`:

```tsx
import { View, Text, Pressable, Image } from "react-native";
import { useRouter } from "expo-router";
import type { Summary, ImageClipMetadata } from "@cliphy/shared";
import { brutalShadowSm } from "../lib/theme";

export function ImageCard({ item }: { item: Summary }) {
  const router = useRouter();
  const meta = (item.sourceMetadata ?? {}) as unknown as ImageClipMetadata;
  const processing = item.status === "pending" || item.status === "processing";

  return (
    <Pressable
      onPress={() => router.push(`/summary/${item.id}`)}
      className="border-2 border-black dark:border-[#505050] rounded-lg p-3 bg-[#f9fafb] dark:bg-[#282828]"
      style={brutalShadowSm()}
      accessibilityRole="button"
      accessibilityLabel="Image clip"
    >
      {item.heroImageUrl ? (
        <Image
          source={{ uri: item.heroImageUrl }}
          resizeMode="cover"
          className="w-full h-40 rounded-md border-2 border-black dark:border-[#505050] mb-2 bg-[#e5e7eb] dark:bg-[#1e1e1e]"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {meta.tweet ? (
        <Text
          className="text-xs text-[#6b7280] dark:text-[#9ca3af] mb-1"
          style={{ fontFamily: "DMSans" }}
        >
          🐦 @{meta.tweet.handle}
        </Text>
      ) : null}
      <Text
        className="text-sm text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
        numberOfLines={3}
      >
        {processing ? "Processing…" : (item.excerpt ?? item.content ?? "Image")}
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 3: Dispatch `image` in `ClipCard`**

In `apps/mobile/components/ClipCard.tsx`, add the image branch:

```tsx
import { ImageCard } from "./ImageCard";
// inside ClipCard, before the youtube fallback:
if (item.sourceType === "image") return <ImageCard item={item} />;
```

- [ ] **Step 4: `CaptureSheet` (library + camera)**

Create `apps/mobile/components/CaptureSheet.tsx`:

```tsx
import { View, Text, Pressable, Modal, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { brutalShadow } from "../lib/theme";
import { uploadAndClipImage } from "../lib/uploadImage";

export function CaptureSheet({
  visible,
  onClose,
  onCaptured,
}: {
  visible: boolean;
  onClose: () => void;
  onCaptured: () => void;
}) {
  async function handle(pick: () => Promise<ImagePicker.ImagePickerResult>) {
    onClose();
    const result = await pick();
    if (result.canceled || !result.assets?.[0]) return;
    try {
      await uploadAndClipImage(result.assets[0].uri);
      onCaptured();
    } catch (err) {
      Alert.alert("Couldn't save image", err instanceof Error ? err.message : "Try again");
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40 justify-end" onPress={onClose}>
        <View
          className="bg-white dark:bg-[#282828] border-2 border-black dark:border-[#505050] rounded-t-2xl p-4 gap-3"
          style={brutalShadow()}
        >
          <SheetButton
            label="Choose from library"
            onPress={() =>
              handle(() =>
                ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  quality: 1,
                }),
              )
            }
          />
          <SheetButton
            label="Take a photo"
            onPress={async () => {
              const perm = await ImagePicker.requestCameraPermissionsAsync();
              if (!perm.granted) {
                Alert.alert("Camera access needed", "Enable camera access in Settings.");
                return;
              }
              handle(() => ImagePicker.launchCameraAsync({ quality: 1 }));
            }}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

function SheetButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="border-2 border-black dark:border-[#505050] rounded-lg p-3"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text
        className="text-base font-bold text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 5: "+" opens the sheet in the inbox**

In `apps/mobile/app/(tabs)/index.tsx`: import `CaptureSheet`, add `const [captureOpen, setCaptureOpen] = useState(false);`, add a "+" `Pressable` in the header row (right-aligned) that calls `setCaptureOpen(true)`, and render `<CaptureSheet visible={captureOpen} onClose={() => setCaptureOpen(false)} onCaptured={fetchData} />` near the bottom of the screen (before `</SafeAreaView>`). The header currently ends after the "Cliphy" title `Text`; wrap the row so the "+" sits at the end:

```tsx
<Pressable
  onPress={() => setCaptureOpen(true)}
  className="ml-auto w-9 h-9 items-center justify-center rounded-full border-2 border-black dark:border-[#505050]"
  accessibilityRole="button"
  accessibilityLabel="Add a clip"
>
  <Text className="text-lg font-bold text-[#111827] dark:text-white">＋</Text>
</Pressable>
```

- [ ] **Step 6: Share-intent image branch**

In `apps/mobile/app/_layout.tsx`, the share effect currently reads `shareIntent.text`. Extend it to handle shared images. `expo-share-intent` exposes files/images on `shareIntent.files`. Before the URL-matching block, add:

```tsx
const sharedImage = shareIntent?.files?.find((f) => f.mimeType?.startsWith("image/"));
if (sharedImage) {
  resetShareIntent();
  processingShareRef.current = true;
  uploadAndClipImage(sharedImage.path)
    .then(() => Alert.alert("Saved to Cliphy", "Image saved"))
    .catch((err: unknown) => showQueueError(err))
    .finally(() => {
      processingShareRef.current = false;
    });
  return;
}
```

Add `import { uploadAndClipImage } from "../lib/uploadImage";` and include `shareIntent?.files` usage. Keep the existing `shareIntent?.text` URL path below it. (If `files` isn't in the effect's guard, widen the initial `if (!shareIntent?.text ...)` guard to also proceed when `shareIntent?.files?.length`.)

- [ ] **Step 7: Generalize the detail header for image clips**

In `apps/mobile/app/summary/[id].tsx`, the "Video info header" shows a YouTube thumbnail only when `summary.videoId`. Add an image-clip branch: when `summary.sourceType === "image"` and `summary.heroImageUrl`, render that image instead (natural aspect, not 16:9), and skip the "Watch on YouTube" link. Replace the `{summary.videoId && (...)}` image with:

```tsx
{
  summary.sourceType === "image" && summary.heroImageUrl ? (
    <Image
      source={{ uri: summary.heroImageUrl }}
      style={{ width: "100%", aspectRatio: 3 / 4 }}
      resizeMode="contain"
      accessibilityLabel="Captured image"
    />
  ) : summary.videoId ? (
    <Image
      source={{ uri: `https://i.ytimg.com/vi/${summary.videoId}/mqdefault.jpg` }}
      style={{ width: "100%", aspectRatio: 16 / 9 }}
      resizeMode="cover"
      accessibilityLabel="Video thumbnail"
    />
  ) : null;
}
```

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter mobile typecheck`
Expected: no errors. (Fix any `sourceMetadata` casts with `as unknown as ImageClipMetadata` as in `WebCard`.)

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/components/CaptureSheet.tsx apps/mobile/components/ImageCard.tsx apps/mobile/components/ClipCard.tsx "apps/mobile/app/(tabs)/index.tsx" apps/mobile/app/_layout.tsx apps/mobile/app/summary/[id].tsx apps/mobile/app.json
git commit -m "mobile: image capture sheet, ImageCard, share-intent images, detail header

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Smoke tests, ADR, devlog

**Files:**

- Create: `apps/server/scripts/smoke-test-vision.test.ts`
- Create: `docs/decisions/0044-claude-vision-and-direct-storage-upload.md`
- Create: `docs/devlog/2026-09-06-image-ocr-capture.md`
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: Live vision smoke test (opt-in)**

Create `apps/server/scripts/smoke-test-vision.test.ts` guarded by `RUN_CLIP_SMOKE=1`. Generate a text image and a plain image with `sharp` (text via an SVG overlay), call `analyzeImage`, and assert: the text image yields non-empty `extractedText`; the plain image yields a non-empty `description`.

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import sharp from "sharp";
import { analyzeImage } from "../src/services/vision.js";

const run = process.env.RUN_CLIP_SMOKE === "1";
const maybe = run ? it : it.skip;

describe("vision smoke (live)", () => {
  beforeEach(() => {
    layer("integration");
    epic("Ingest");
    feature("Vision Smoke");
  });

  maybe(
    "OCRs a text image",
    async () => {
      const svg = `<svg width="600" height="200"><rect width="600" height="200" fill="white"/><text x="20" y="110" font-size="48" fill="black">Cliphy OCR test</text></svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      const r = await analyzeImage(png, "image/png");
      expect(r.extractedText.toLowerCase()).toContain("cliphy");
    },
    30_000,
  );

  maybe(
    "describes a plain image",
    async () => {
      const png = await sharp({
        create: { width: 400, height: 400, channels: 3, background: { r: 20, g: 120, b: 200 } },
      })
        .png()
        .toBuffer();
      const r = await analyzeImage(png, "image/png");
      expect(r.description.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
```

Run: `RUN_CLIP_SMOKE=1 pnpm vitest run apps/server/scripts/smoke-test-vision.test.ts` → PASS (or SKIP when unset).

- [ ] **Step 2: Write the ADR**

Create `docs/decisions/0044-claude-vision-and-direct-storage-upload.md` (read `docs/.lore/types/decision.schema.yaml` first). Document: Claude vision (`claude-sonnet-4-6`) as a single OCR+describe+tweet-detect engine instead of Tesseract (fewer moving parts, already on Anthropic, multimodal); direct-to-Storage upload from the client instead of via the serverless function (avoids Vercel's ~4.5MB payload limit); tall-image tiling with `sharp`. Tradeoffs: per-image vision cost (~$0.01–0.03), sonnet vs. haiku for accuracy.

- [ ] **Step 3: Write the devlog + backlog**

Create `docs/devlog/2026-09-06-image-ocr-capture.md` (read `docs/.lore/types/devlog.schema.yaml` first): what shipped, decisions, and follow-ups (PDF full-page screenshots, video, auto-detect screenshots, orphaned-upload cleanup all deferred). Add `docs/BACKLOG.md` lines for those deferred items.

- [ ] **Step 4: Commit**

```bash
git add apps/server/scripts/smoke-test-vision.test.ts docs/decisions docs/devlog docs/BACKLOG.md
git commit -m "add vision smoke tests, document vision + storage decisions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

- `image` source type + metadata → Task 1 ✓
- source_type constraint + Storage bucket + RLS → Task 2 ✓
- Type-aware vision (text/visual) + tweet detection → Tasks 3, 4 ✓
- Tall-image tiling → Task 5 (tiling) + Task 6 (worker applies it) ✓
- Vision worker + reuse of enrichment/embedding → Task 6 ✓
- `/api/clips` image branch + signed-URL read resolution → Task 7 ✓
- Direct-to-Storage upload + downscale → Task 8 ✓
- Capture surfaces (library/camera/share) → Task 9 (steps 1, 4, 5, 6) ✓
- ImageCard + tweet-in-image display + detail generalization → Task 9 (steps 2, 3, 7) ✓
- Error handling (vision fail → failed clip; tile fail → partial; tweet refetch fail → fallback) → Task 6 ✓
- Testing (unit + smoke) → every task + Task 10 ✓

**Placeholder scan:** No "TBD/handle edge cases." Task 7 step 6 and Task 9 steps 5–7 describe edits against real, quoted anchor code rather than pasting whole large files — each shows the exact replacement block.

**Type consistency:** `VisionResult` (Task 3) is consumed unchanged by `analyzeImage` (Task 4) and the worker (Task 6). `ImageClipMetadata` (Task 1) matches the `source_metadata` the worker writes (Task 6) and the cards read (Task 9). `signImageUrl` (Task 5) is consumed by Task 7. `uploadAndClipImage`/`storagePathFor` (Task 8) are consumed by Task 9. Event names consistent: route fires `clip/vision.requested` (Task 7) → worker triggers on it (Task 6) → worker fires `clip/embed.requested` (Task 6) → existing embed worker (unchanged trigger). `addClip({imagePath})` (Task 8) matches the route body (Task 7).

**Deviation from spec noted:** the spec suggested tweet-in-image clips "render via TweetCard." Because `TweetCard` reads a tweet-shaped `source_metadata` (handle/media at top level) while image clips nest tweet data under `source_metadata.tweet`, `ImageCard` renders the tweet inline (handle badge + text) instead of reusing `TweetCard`. Simpler and avoids a fragile metadata adapter; same user-visible outcome.
