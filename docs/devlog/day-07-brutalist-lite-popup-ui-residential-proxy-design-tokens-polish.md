---
day: 7
date: 2026-02-23
phase: MVP
mood: 😎 Smooth
hours:
tags: [frontend, UI]
published_to: []
public: false
title: "Day 7 — Brutalist-lite popup UI, residential proxy, design tokens & polish"
---

Redesigned the extension popup with a brutalist-lite aesthetic, threaded videoTitle through the queue pipeline, added residential proxy for YouTube transcript fetching, then polished with design tokens, thumbnails, and layout cleanup.

## What got done

- Brutalist-lite UI overhaul: square corners, thick black borders, monospace base font, bold uppercase headers, status tags replacing emoji icons
- Compact queue list with relative timestamps ("2m ago", "1h ago")
- Threaded videoTitle through entire chain: popup > background > server > DB insert, so new queue entries show real video titles instead of raw videoIds
- Used 3 parallel worktree agents to implement independent UI changes simultaneously
- Created `apps/server/src/lib/proxy.ts` with fetchViaProxy() helper using undici ProxyAgent + dispatcher option
- Wired proxy into both fetch calls in transcript service (InnerTube Player API + timedtext XML)
- Made proxy helper provider-agnostic with single PROXY_URL env var replacing Webshare-specific config
- Added diagnostic logging to transcript fetch
- Tested on Vercel: confirmed datacenter IP blocking (LOGIN_REQUIRED without proxy)
- Deep research on 10+ proxy providers
- Centralized 4 shadow values as `@theme` tokens (`shadow-brutal`, `shadow-brutal-sm`, `shadow-brutal-hover`, `shadow-brutal-pressed`) and a `press-down` `@utility` — eliminates repeated inline arbitrary values across 4 components (`bf4f7e5`)
- Added YouTube thumbnails to VideoCard (80px `mqdefault.jpg`) and QueueList items (48px `default.jpg`) using `i.ytimg.com/vi/{videoId}/` — no API key needed (`bf4f7e5`)
- Capped queue list to 5 items with "View all (N)" link; always shows "View all" even when ≤5 items so users can always reach summaries page (`bf4f7e5`)
- Added `deleteQueueItem` API call + "Clear failed" button with loading state next to Queue heading (`bf4f7e5`)
- Moved email + sign out to sticky footer with `mt-auto` so they anchor to bottom regardless of content height (`bf4f7e5`)
- Toned down Queue section heading and softened queue thumbnail borders (`bf4f7e5`)

## Decisions

- Chose brutalist-lite over full brutalist or neo-brutalist: less disruptive, keeps current layout, adds personality through typography and borders
- Stayed Tailwind-only, no component library: all changes are utility class swaps
- Switched from Webshare to DataImpulse: 3.5x cheaper ($1/GB vs $3.50/GB), non-expiring bandwidth, $5 entry point. Webshare had KYC issues, Decodo was best-rated but $7.50/GB
- Used Tailwind v4 `@theme` + `@utility` instead of a JS config file or component abstractions — see Decisions Log

## Issues

- Queue items showed raw videoIds instead of titles. Root cause: videoTitle was never passed from popup through to the server DB insert. Fixed by threading it through AddToQueueMessage, QueueAddRequest, background script, and server route
- Old queue entries still show videoIds since title was never stored, only new entries will have titles
- YouTube strips captions from datacenter IP responses (all major cloud providers), needs residential proxy
- undici is bundled with Node.js at runtime but TypeScript needs type declarations, added as devDependency
- Still need to verify dispatcher option works in Vercel Node.js 20.x runtime

## What to remember

- Extension hits production Vercel server, not [localhost](http://localhost/). Server changes need deploy to take effect
- Worktree agents work well for parallel UI changes on non-overlapping files
- YouTube blocks datacenter IPs from fetching captions. Residential proxy required
- PROXY_URL env var activates proxy; falls back to direct fetch when not set (local dev)

---

## Commits

- `d4439db` — brutalist-lite popup UI redesign and pass videoTitle through queue
- `9e77b78` — add Webshare rotating proxy for transcript fetching
- `37584d2` — add diagnostic logging to transcript fetch
- `6427eb0` — make proxy helper provider-agnostic
- `25cbe59` — restyle popup UI to neo-brutalist with indigo accents
- `bf4f7e5` — polish popup UI: design tokens, thumbnails, layout improvements

## Tomorrow's plan

- Sign up for DataImpulse $5 intro plan
- Set PROXY_URL in Vercel, test transcript fetching end-to-end
