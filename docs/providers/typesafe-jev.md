---
type: provider
title: TypeSafe AI (Jev)
category: AI
status: Active
plan: "API pay-per-use (jev-1.13.0, pinned)"
date_evaluated: 2026-10-09
---

# TypeSafe AI (Jev)

## Why

Classification model (`systemOne`): answers typed questions (yes/no "noul", choice, score) about a state in one call, ~70–500ms. Used by the auto-tag pipeline step to decide which of a user's existing tags apply to a summarized video and whether Claude-proposed topics duplicate an existing tag. It can't generate text, so Claude still proposes new tag names (`summaryJson.topics`). SDK: `@typesafe-ai/sdk`; key in `TYPESAFE_API_KEY` (server `.env.local` + Vercel production/preview). Missing key → step skips, summaries unaffected. New signups were paused late Sept 2026 — existing account only.

## Cost notes

$0.042/1M input tokens, output free. One call per summarized video (summary + key points + N tag questions) — fractions of a cent per clip. Rate limits ~80 req/s, 100k tokens/s (dynamic); SDK retries 429s twice.
