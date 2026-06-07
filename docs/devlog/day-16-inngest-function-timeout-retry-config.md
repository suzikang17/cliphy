---
day: 16
date: 2026-03-17
phase: Post-Launch
mood: 😎 Smooth
hours:
tags: [backend]
published_to: []
public: false
title: "Day 16 — Inngest function timeout & retry config"
---

Quick fix session — added timeout and explicit retry config to the summarize-video Inngest function to prevent summaries from getting stuck in "processing" state forever.

## What got done

- Identified that the Inngest function had no timeout or explicit retry config — a hung step (e.g. Anthropic API never responds) would leave summaries stuck in `processing` forever with no Sentry alert and no usage rollback
- Added `timeouts: { finish: "5m" }` and `retries: 3` to the function config (`ff11379`)
- Now Inngest cancels and triggers `onFailure` after 5 minutes, which marks it failed, rolls back usage count, and reports to Sentry

## What to remember

- Inngest defaults to 3 retries but has no default function-level timeout — always set `timeouts.finish` for serverless functions
- Without explicit timeout, the `onFailure` handler never fires for hung steps, so usage rollback and error reporting are silently skipped

---

## Commits

- `ff11379` — add timeout and explicit retries to summarize-video Inngest function
