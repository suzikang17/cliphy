---
date: 2026-02-21
title: "Synchronous queue processing for MVP background worker"
category: Tech
revisit: true
---

# Synchronous queue processing for MVP background worker

**Date:** 2026-02-21 · **Category:** Tech · **Revisit?** yes

## Why this choice

No async processing pipeline exists yet. Vercel has 60s timeout limit (SSE won't work). Synchronous is simplest — background worker calls POST /api/queue then POST /api/queue/:id/process and gets result directly.

## Options considered

1. Synchronous (background worker drives queue→process sequentially)
2. Server-Sent Events for real-time updates
3. Polling from extension

## Tradeoffs

Extension blocked during summarization (~10-30s). Service worker could get killed mid-process. Batch operations not feasible. Will need async pipeline for production scale.
