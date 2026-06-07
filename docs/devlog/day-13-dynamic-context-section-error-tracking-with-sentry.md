---
day: 13
date: 2026-03-04
phase: Growth
mood: 😎 Smooth
hours:
tags: [prompt-eng, frontend, backend]
published_to: []
public: false
title: "Day 13 — Dynamic Context Section + Error Tracking with Sentry"
---

Two sessions combined: replaced hardcoded Action Items with AI-chosen dynamic context section, then implemented full Sentry error tracking across server and extension with structured logging and Discord alerts.

## What got done

### Dynamic Context Section

- Designed and implemented dynamic `contextSection` — AI picks title, emoji, and items based on video type (`0e68975`..`0c7e599`)
- Added `ContextSection` type to shared package, deprecated `actionItems` (`0e68975`)
- Updated summarizer prompt with contextSection guidelines and examples (`2943fef`)
- Updated `parseSummaryResponse` with validation, sanitization, and backward compat (`5ef51ee`)
- Updated frontend `SummaryDetail` with `resolveContextSection` helper — bridges old/new format (`08cee3d`)
- Updated eval prompts and transforms (`0adad22`)
- Added 6 new parser unit tests, all 107 tests pass
- Design doc + implementation plan written and committed (`0c7e599`)

### Error Tracking with Sentry

- **Server Sentry init**: `@sentry/node` with Hono `onError` handler, `HTTPException` passthrough, `Sentry.flush()` for serverless (`a1fc7ba`, `191d2d1`, `cba0eb1`)
- **Structured JSON logger**: `Logger` class with `info/warn/error` + `child()` scoped context + Sentry breadcrumbs (`75971d5`)
- **Console call migration**: All 10 server `console.log/error` calls replaced with structured logger (`185987d`)
- **Inngest failure capture**: `onFailure` reports to Sentry with summaryId/videoId context + `component: "inngest"` tag (`bfb98c3`)
- **Extension Sentry init**: `@sentry/react` for React pages, manual `BrowserClient` for background SW (`344b08b`)
- **React ErrorBoundary**: `ErrorFallback` component wrapping sidepanel + summaries pages (`470a209`)
- **Background script capture**: Unexpected errors only — filters RateLimitError/ProRequiredError (`6afb47f`, `59803f1`)
- **API client capture**: 5xx responses + non-TypeError network errors (`2a44b66`)
- **Source map upload script**: Gated on `SENTRY_AUTH_TOKEN`, runs `@sentry/cli sourcemaps inject + upload` (`ad1007e`)
- **Env vars + docs**: `.env.example` updated (`fe285d5`), Sentry projects created, Vercel env vars set
- **Discord alerts**: Two channels (`#server-errors`, `#extension-errors`), alerts on new issues + regressions
- **Production test**: Confirmed error appears in Sentry dashboard and triggers Discord notification

## Decisions

- **Freeform titles + emoji** over predefined set — lets the AI pick what fits naturally ("Recipe 🍳" vs forced "Action Items")
- **Single optional object** over array of sections or dual fields — YAGNI, clean type
- **Backward compat via frontend helper** — old summaries with `actionItems` render as "Action Items →" without DB migration
- **Sentry** over Vercel Monitoring, BetterStack, [Highlight.io](http://highlight.io/), Bugsnag (see Decisions Log)
- **Errors only** — `tracesSampleRate: 0`, no performance tracing to keep quota low
- **Structured logging** — thin JSON wrapper over console + Sentry breadcrumbs, not a full aggregation service
- **Manual BrowserClient** for background SW — service workers lack `window`, can't use `Sentry.init()` global handlers
- **Discord** for alerts over Telegram/Slack — easiest setup, generous free tier, native Sentry integration

## Issues

- **Events not appearing in Sentry** — Vercel serverless functions exit before Sentry can transmit. Fix: `await Sentry.flush(2000)` in `onError` (`cba0eb1`)
- **Vercel sensitive env vars** — can't target `development` environment. Skipped dev target (local `.env` used instead)
- **Context menu captured expected errors** — code review caught that RateLimitError/ProRequiredError were being sent to Sentry from the context menu handler. Fix: added `instanceof` guards (`59803f1`)

## What to remember

- JSONB storage means no migration needed for schema changes to `summary_json`
- `resolveContextSection()` in `SummaryDetail.tsx` bridges old/new format — check there if rendering issues
- Eval fixtures still have old `actionItems` format — they'll work but won't test contextSection output
- `Sentry.flush()` is **required** in serverless (Vercel) — without it, events are silently lost
- `printf '%s'` not `echo` when piping to `vercel env add` (avoids trailing newline)
- Sensitive Vercel env vars can only target production + preview, not development
- Extension Sentry needs `VITE_SENTRY_DSN` baked in at build time — rebuild after adding
- Background SW needs `BrowserClient` with filtered integrations (no `BrowserApiErrors`, `Breadcrumbs`, `GlobalHandlers`)
- Hono's `logger` middleware must be aliased to `honoLogger` when importing our structured logger

---

## Commits

### Context Section

- `0e68975` add ContextSection type, deprecate actionItems
- `2943fef` update prompt to use dynamic contextSection
- `5ef51ee` update parser to handle contextSection
- `c0cb37e` update summarize-video test to use contextSection
- `08cee3d` render dynamic contextSection in summary detail
- `0adad22` update eval prompts and transforms for contextSection
- `0c7e599` add dynamic context section design and plan docs

### Sentry

- `57ca294` — add error tracking design doc
- `2907c3a` — add error tracking implementation plan
- `a1fc7ba` — add Sentry init and Hono error handler for server
- `191d2d1` — handle HTTPException in onError, log errors to stderr
- `75971d5` — add structured JSON logger with Sentry breadcrumbs
- `185987d` — migrate server console calls to structured logger
- `bfb98c3` — report Inngest job failures to Sentry
- `344b08b` — add Sentry init for extension (React pages + background SW)
- `470a209` — add React error boundary with Sentry for extension pages
- `6afb47f` — add Sentry error capture to background script
- `59803f1` — filter expected errors from Sentry in context menu handler
- `2a44b66` — report unexpected API errors to Sentry from extension
- `ad1007e` — add source map upload script for Sentry
- `fe285d5` — add Sentry env vars to .env.example
- `091639e` — add temporary debug-sentry route for testing
- `cba0eb1` — flush Sentry before response in serverless onError
- `55bc573` — remove debug-sentry test route
