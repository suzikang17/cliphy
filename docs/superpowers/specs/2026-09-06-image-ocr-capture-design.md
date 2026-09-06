# Image / Screenshot OCR Capture — Design Spec

**Date:** 2026-09-06
**Status:** Approved, pre-implementation
**Scope:** Subproject #2 of the "universal clipping platform" pivot

## Context

Subproject #1 shipped universal URL ingest (web + tweets) with AI enrichment and
a unified inbox. Subproject #2 adds **image capture**: screenshots (phone/
computer), photos of labels/menus/whiteboards, and images containing tweets get
OCR'd + AI-described and land in the same inbox. It also serves as the
**tweet-thread / X-URL-in-image fallback** promised in #1 (free tweet endpoints
can't stitch forward threads; a thread screenshot can).

Nothing image-related exists yet: no image-capture libraries, no Supabase
Storage usage, no Claude vision calls. All net-new. Because Cliphy is already on
Anthropic and Claude is multimodal, a single vision call does OCR + description +
tweet detection — no separate OCR engine (Tesseract) needed.

## Goals

- Capture images via photo library, in-app camera, and the share sheet.
- **Type-aware processing** (mirrors #1's article/visual split): Claude vision
  classifies each image as text-heavy (→ extract text) or visual (→ describe).
- **Tweet-in-image handling:** if a tweet URL is visible, re-fetch via #1's
  `extractTweetClip` (full fidelity); otherwise reconstruct the tweet
  (author/handle/text) from the image.
- **Tall / stitched screenshots:** tile into vertical segments so text stays
  legible, then merge.
- Store the original image (private Supabase Storage) so it displays back.
- Reuse #1's enrichment + embedding + inbox entirely.

## Non-Goals (this phase)

- iOS "Full Page" screenshots (they export as PDF → needs PDF rendering; deferred).
- Video / screen recordings (separate pipeline: frame sampling + audio; deferred).
- Auto-detecting recent screenshots on app open (deferred).
- Orphaned-upload cleanup job (logged to backlog).
- The polished inbox/detail redesign (subproject #4).

## Architecture

```
MOBILE
 pick / camera / share-sheet image
   → downscale + compress on-device (expo-image-manipulator)
   → upload to Supabase Storage (private bucket clip-images/<userId>/<uuid>.jpg, RLS)
   → POST /api/clips  { imagePath: "<userId>/<uuid>.jpg" }

SERVER  (POST /api/clips — extend universal ingest)
   → sourceType "image"; create clip (status: pending, hero_image_url = storage path)
   → fire  clip/vision.requested

INNGEST  visionClip worker
   → read image from Storage (service-role)
   → if very tall (height/width > ~4): tile into overlapping vertical segments
   → Claude vision (one call per tile): classify kind text|visual; extract text OR
     describe; detect visible tweet URL and/or reconstruct a tweet
   → merge tiles
   → if tweet detected:
        URL visible → re-run extractTweetClip() from #1 (full fidelity)
        else        → store reconstructed tweet in source_metadata.tweet
   → write content + source_metadata
   → fire  clip/embed.requested   (reuses #1 enrichment: summary + tags + category)

INBOX → ImageCard (image + caption); tweet-detected clips render via TweetCard
```

Everything downstream of "write content" is the exact #1 pipeline. This
subproject adds a capture surface and a vision worker; the rest is shared.

## Vision service — `apps/server/src/services/vision.ts`

```typescript
export interface VisionResult {
  kind: "text" | "visual";
  extractedText: string; // OCR'd text (text kind) or "" (visual)
  description: string; // short "what this is" caption (always)
  detectedTweetUrl?: string;
  reconstructedTweet?: { handle: string; author: string; text: string };
}
export function parseVisionResult(raw: string): VisionResult; // unit-tested
export function shouldTile(width: number, height: number): boolean; // aspect-ratio threshold
export function mergeTiles(results: VisionResult[]): VisionResult; // tall images
export async function analyzeImage(imageBytes: Buffer, mediaType: string): Promise<VisionResult>;
```

- **Model:** `claude-sonnet-4-6` (OCR accuracy needs the stronger model, not Haiku).
  One multimodal call: base64 `image` content block + a structured-JSON prompt.
- **Type-aware:** prompt classifies text-heavy vs. visual, filling `extractedText`
  or `description`.
- **Tweet detection:** prompt returns any visible tweet URL and, if it's clearly a
  tweet/thread, reconstructs handle/author/text.
- **Tiling:** `shouldTile` true when `height / width > 4`; split into overlapping
  vertical tiles; `mergeTiles` concatenates `extractedText` in order, unions
  `description`, takes the first tweet detection, and sets `partial` if any tile
  errored.
- **Parsing:** `parseVisionResult` tolerates fenced JSON / missing fields,
  defaulting to `kind: "visual"` (mirrors `parseEnrichment`).

Cost: a typical screenshot ≈ one Sonnet vision call (~$0.01–0.03); tall images
cost one call per tile.

## Storage & data model

**Supabase Storage:** private bucket `clip-images`, path `<userId>/<uuid>.jpg`.
RLS: a user may insert/select/delete only under their own `<userId>/` prefix
(same per-user pattern as the `clips` table). Server reads via service-role for
the worker; mobile displays via short-lived **signed URLs** (bucket is private).

**Migration `025_image_clips.sql`:**

- Extend `source_type` check constraint to add `'image'`.
- Create the `clip-images` bucket + RLS policies on `storage.objects`.
- No new `clips` columns — reuse existing:
  - `hero_image_url` → storage path (resolved to a signed URL at read time).
  - `content` → OCR text (text kind) or description (visual kind).
  - `excerpt` → first line of text, or the description.
  - `source_metadata` → `{ kind, storagePath, width, height, tiled, partial?,
tweet?: {handle,author,text}, detectedTweetUrl? }`.

**Signed-URL resolution:** `hero_image_url` holds a storage path for image clips,
not a public URL. A `signImageUrl()` step in the clips read route + list
serialization resolves image-clip paths to signed URLs so mobile always receives
a ready-to-display URL. (Non-image clips keep their external `hero_image_url`
untouched — detect by `source_type === "image"`.)

**Shared types:** `SourceType` += `"image"`; `SOURCE_TYPES.IMAGE = "image"`; add
`ImageClipMetadata` mirroring the `source_metadata` shape.

## Mobile capture & display

**New deps:** `expo-image-picker` (library + camera), `expo-image-manipulator`
(resize/compress).

**Capture — a "+" action on the inbox opens a sheet:**

- Photo library → `ImagePicker.launchImageLibraryAsync`.
- Camera → `ImagePicker.launchCameraAsync`.
- Share sheet → extend `expo-share-intent` config with
  `NSExtensionActivationSupportsImageWithMaxCount: 1` (iOS) + `image/*` intent
  filter (Android); the `_layout.tsx` share handler branches URL vs. image.

**Upload helper `apps/mobile/lib/uploadImage.ts`:**

1. `manipulateAsync` → resize to ~2000px long edge, JPEG quality ~0.8.
2. Upload to Storage `<userId>/<uuid>.jpg` via the mobile Supabase client.
3. `addClip({ imagePath })` → pending clip; streams to processed via Realtime
   (fixed in #1's follow-up).

**Display:**

- `ImageCard` (inbox): image (signed URL) + AI caption + category chip +
  "processing…" state while vision runs.
- Tweet-detected image clips render via the existing `TweetCard` when
  `source_metadata.tweet` is present.
- `summary/[id].tsx`: generalize the still-YouTube-shaped header to show the
  image (via `heroImageUrl`) for image clips, extracted text / description below.
  Targeted change to fit the universal model — not the #4 redesign.

## Error handling

- **Upload fails** → mobile retry; no clip created until the path POSTs (nothing
  half-saved).
- **Vision fails** → clip saved `status: "failed"` + `error_message`; image still
  displays; retry re-fires `clip/vision.requested`.
- **Tweet re-fetch fails** → fall back to reconstructed tweet or plain OCR text;
  never lose the capture.
- **Tile failure** → merge successful tiles, set `source_metadata.partial = true`
  rather than failing the whole clip.
- **Orphaned uploads** (uploaded but POST never lands) → cleanup deferred; logged
  to backlog.

## Testing

- **Unit (Vitest):** `parseVisionResult` (fenced JSON, missing fields, tweet
  detection); `mergeTiles` (text order, tweet-detection precedence, partial flag);
  `shouldTile` (aspect-ratio threshold); `/api/clips` image branch (mocked storage
  - vision) routes correctly and saves a `failed` clip on vision error.
- **Smoke (opt-in, `RUN_CLIP_SMOKE=1`):** `analyzeImage` against a real text
  screenshot and a real photo, asserting non-empty `extractedText` / `description`.
- **Mobile:** typecheck; upload-helper resize/quality params unit-tested if practical.

## Build sequence

1. Shared types (`image` source type, `ImageClipMetadata`) + `SOURCE_TYPES.IMAGE`.
2. Migration `025`: `source_type` constraint + `clip-images` bucket + RLS.
3. `vision.ts` — `parseVisionResult`, `shouldTile`, `mergeTiles` (pure, unit-tested).
4. `vision.ts` — `analyzeImage` (Claude vision call).
5. `visionClip` Inngest worker (tiling, tweet re-route, fire enrichment) + register.
6. `/api/clips` image branch (`imagePath`) + `signImageUrl` read-path resolution.
7. Mobile: `uploadImage.ts` helper + deps.
8. Mobile: capture sheet (library/camera) + share-intent image branch.
9. Mobile: `ImageCard` + generalized detail-screen header.
10. Smoke tests + devlog + ADR (Claude vision over Tesseract; direct-to-Storage upload).
