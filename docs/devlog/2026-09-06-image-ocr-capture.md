---
title: "Image / screenshot OCR capture"
date: 2026-09-06
phase: "Clipping-platform pivot (subproject #2)"
---

**Shipped subproject #2: capture images (library / camera / share sheet), OCR + describe them with Claude vision, store the original in Supabase Storage, and surface enriched image clips in the unified inbox.**

## What got done

- Shared: `SourceType` += `"image"`, `SOURCE_TYPES.IMAGE`, `ImageClipMetadata`.
- Migration `025`: `source_type` constraint incl. `image`; private `clip-images`
  Storage bucket with per-user RLS on `storage.objects`.
- `services/vision.ts`: `parseVisionResult` / `shouldTile` (height/width > 4) /
  `mergeTiles` (pure, unit-tested) + `analyzeImage` (Claude `claude-sonnet-4-6`,
  base64 image block → OCR + description + tweet detection).
- `services/tiling.ts` (`sharp`): `imageSize` + `tileImage` (overlapping vertical
  tiles for tall/stitched screenshots).
- `lib/storage.ts`: `downloadImage` (service-role) + `signImageUrl` (1h signed URL).
- `functions/visionClip.ts`: Inngest worker on `clip/vision.requested` — download →
  (tile if tall) → analyze per tile → merge → tweet re-fetch when a URL is visible
  → write `content`/`excerpt`/`source_metadata` → fire `clip/embed.requested`.
- `embed-clip.ts`: enrichment condition now includes `image`.
- `/api/clips`: `imagePath` branch creates a pending image clip, fires vision, and
  returns a signed hero URL; `resolveClipImage` signs image clips on the inbox
  list (`/api/queue`), search, and detail reads.
- Mobile: `uploadImage.ts` (downscale + direct Storage upload + `addClip`),
  `CaptureSheet` (library/camera), `ImageCard`, `ClipCard` dispatch, "+" button in
  the inbox header, share-intent image branch, generalized detail-screen header,
  `app.json` image share rules + `expo-image-picker` plugin.
- Live vision smoke tests (`RUN_CLIP_SMOKE=1`) — Claude OCR'd rendered text and
  described a plain image; both green.

## Decisions

- Claude vision as a single OCR+describe+tweet-detect engine (no Tesseract); direct
  client→Storage upload (avoids Vercel's ~4.5MB serverless payload limit); `sharp`
  tiling for tall images. See ADR 0044.
- Tweet-in-image clips render inline in `ImageCard` (handle badge + text), not via
  `TweetCard` — the metadata shapes differ (image nests tweet under
  `source_metadata.tweet`), so reusing `TweetCard` would need a fragile adapter.

## Issues

- **`sharp` native lib in the sandbox:** the pnpm-nested `@img/sharp-libvips-linux-x64`
  `.so` wasn't resolvable via rpath, so tests needed
  `LD_LIBRARY_PATH=node_modules/@img/sharp-libvips-linux-x64/lib`. Vercel/GitHub
  Actions install sharp cleanly, so CI/prod are unaffected — this is sandbox-only.
- **Pre-existing failures unchanged:** the same 5 unrelated tests (`embedding` stale
  voyage-3 assertion, `summarize-video`, `admin/users`) still fail in-sandbox; none
  are touched by this feature.

## What to remember

- Image clips store the Storage **path** in `hero_image_url`; `resolveClipImage`
  swaps it for a signed URL on every read path. Non-image clips keep their external
  hero URL untouched (branch on `sourceType === "image"`).
- Vision worker triggers on `clip/vision.requested`; it fires `clip/embed.requested`
  to reuse the #1 enrichment/embedding pipeline.
- Run vision/tiling tests locally with the `LD_LIBRARY_PATH` shim above.

---

## Commits

- feat: add image source type and ImageClipMetadata
- feat: add image source type constraint and clip-images storage bucket
- feat: add vision result parsing, tiling threshold, and tile merge helpers
- feat: add analyzeImage Claude vision call
- feat: add storage download/sign helpers and sharp-based image tiling
- feat: add visionClip worker: OCR/describe images, tweet re-fetch, fire enrichment
- feat: accept image clips at POST /api/clips and sign image urls on read
- feat: mobile image downscale + storage upload + addClip(imagePath) helper
- feat: mobile image capture sheet, ImageCard, share-intent images, detail header

## Tomorrow's plan

- Subproject #3: AI enrichment improvements (better auto-tagging across all types).
- Subproject #4: the polished inbox/detail redesign.
- Backlog: PDF full-page screenshots, video capture, auto-detect recent screenshots,
  orphaned-upload cleanup.
