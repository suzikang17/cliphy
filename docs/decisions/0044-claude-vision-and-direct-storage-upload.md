---
title: "Claude vision for image OCR + direct-to-Storage upload for captures"
date: 2026-09-06
category: Tech
revisit: false
---

## Why this choice

Subproject #2 lets users capture images (screenshots, photos, tweet screenshots)
into the unified inbox. Two decisions shaped the pipeline: how to read the image,
and how to get it from device to processing.

**Reading:** Claude vision (`claude-sonnet-4-6`) does OCR + a "what is this"
description + tweet detection in a single multimodal call. Cliphy is already on
the Anthropic SDK, so this adds zero new infra and no separate OCR engine. A live
smoke test confirmed it OCRs rendered text and describes plain images. It also
classifies text-heavy vs. visual images, mirroring the article/visual split from
subproject #1, and can reconstruct a tweet from a screenshot or surface a visible
tweet URL for a full-fidelity re-fetch through the #1 tweet extractor.

**Upload:** the mobile app downscales the image (expo-image-manipulator, ~2000px,
JPEG q0.8) and uploads it **directly** to a private Supabase Storage bucket
(`clip-images`, per-user RLS), then POSTs only the storage path to `/api/clips`.
Very tall / stitched screenshots are tiled with `sharp` before the vision call so
text stays legible; tiles are merged back.

## Options considered

- **OCR engine:** Claude vision (chosen) vs. Tesseract/self-hosted OCR (more infra,
  worse on messy screenshots, no description) vs. Google Vision / AWS Textract
  (another vendor + cost, text-only).
- **Vision model:** `claude-sonnet-4-6` (chosen, OCR accuracy) vs. Haiku (cheaper but
  weaker on dense text).
- **Upload path:** direct-to-Storage from the client (chosen) vs. base64 through the
  serverless function (hits Vercel's ~4.5MB payload ceiling, slower, more memory).
- **Store original vs. process-only:** store (chosen — visual platform, users must
  see the image back) vs. keep only a thumbnail + text.

## Tradeoffs

- **Gain:** one call for OCR+describe+tweet-detect, no new OCR infra, reuses the #1
  enrichment/embedding/inbox pipeline end-to-end, uploads bypass the serverless
  payload limit, and the original image is always viewable.
- **Give up:** per-image vision cost (~$0.01–0.03; tall images cost one Sonnet call
  per tile), and a `sharp` native dependency on the server (works on Vercel/CI;
  needed an `LD_LIBRARY_PATH` shim only in the local sandbox).
- **Deferred:** iOS full-page (PDF) screenshots, video, auto-detecting recent
  screenshots, and orphaned-upload cleanup — all logged to the backlog.
