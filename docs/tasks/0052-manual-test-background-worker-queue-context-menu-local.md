---
title: "Manual test: background worker queue + context menu (local)"
status: done
owner: none
type: feature
completed: 2026-03-03
---

# Manual test: background worker queue + context menu (local)

Test the background worker changes locally (won't work on deployed Vercel due to 10s timeout). Steps: (1) pnpm dev:server + pnpm dev:extension, (2) Load unpacked from .output/chrome-mv3, (3) Sign in via popup, (4) Test context menu 'Add to Cliphy' on YouTube watch page, (5) Test ADD_TO_QUEUE via popup on YouTube page, (6) Check service worker console for logs (chrome://extensions -> Inspect views). Will work properly on Vercel once async pipeline (Inngest) is implemented. --- All tested across multiple dev sessions.

_Migrated from task-archive.md (CLIP-52, target —)._
