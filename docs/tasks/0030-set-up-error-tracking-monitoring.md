---
title: "Set up error tracking / monitoring"
status: done
owner: none
type: infra
completed: 2026-03-03
---

# Set up error tracking / monitoring

Sentry error tracking for server + extension. Server: @sentry/node with Hono onError handler, structured JSON logger, Inngest failure capture. Extension: @sentry/react for React pages, manual BrowserClient for background SW, ErrorBoundary, API client capture. Source map upload script. Discord alerts configured. Commits: a1fc7ba through 55bc573.

_Migrated from task-archive.md (CLIP-30, target Day 12)._
