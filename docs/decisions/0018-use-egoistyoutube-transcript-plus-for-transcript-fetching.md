---
date: 2026-02-17
title: "Use @egoist/youtube-transcript-plus for transcript fetching"
category: Tech
revisit: true
---

# Use @egoist/youtube-transcript-plus for transcript fetching

**Date:** 2026-02-17 · **Category:** Tech · **Revisit?** yes

## Why this choice

Only JS package that actually works in our ESM setup. Uses Innertube API (same approach as Python package). Authored by egoist (13k GitHub followers, reputable OSS dev). Zero open issues. Keeps stack pure Node.js — no extra runtime or microservice for MVP.

## Options considered

1. youtube-transcript (81k/wk) — broken, returns empty arrays
2. youtubei.js (66k/wk) — 400 error on transcript endpoint
3. youtube-caption-extractor (20k/wk) — broken, returns empty
4. @danielxceron/youtube-transcript (2k/wk) — CJS works, ESM broken
5. @egoist/youtube-transcript-plus (105/wk) — works, ESM, Innertube API
6. Python youtube-transcript-api — works, battle-tested, but adds Python runtime dependency

## Tradeoffs

Low download count (105/wk) means less community testing. If it breaks, may need to switch to Python subprocess or microservice. The fetchTranscript() abstraction makes swapping a 10-minute job.
