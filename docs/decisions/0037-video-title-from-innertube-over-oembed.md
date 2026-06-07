---
date: 2026-06-07
title: "Video title from InnerTube videoDetails over oEmbed / YouTube Data API"
category: Tech
revisit: false
---

# Video title from InnerTube videoDetails over oEmbed / YouTube Data API

**Date:** 2026-06-07 · **Category:** Tech · **Revisit?** no

## Why this choice

Queue items added via the right-click context menu only know the video URL, so titles showed as "Untitled Video". The worker's transcript fetch already calls the InnerTube player API, whose response contains `videoDetails.title` / `author` / `lengthSeconds` — we were parsing and discarding them. So the worker now backfills title/channel/duration from that **same call** (zero extra requests, zero extra proxy load) in `onFailure`'s sibling success path.

## Options considered

- **InnerTube `videoDetails`** (chosen) — already fetched; free; authoritative.
- **oEmbed** (`/oembed`) — shipped first (`58d2635`) then removed. Public, no key, but adds a proxy request per queue-add and fails on private/age/region-restricted videos.
- **YouTube Data API v3** — most reliable, key-authed, no proxy, also gives duration; rejected to avoid a new API key + quota management for a title we already have in hand.

## Tradeoffs

- Title resolves at **process time** (when the worker runs), not instantly at queue-time — fine, since the side panel updates via realtime. The client's scraped title still fills in immediately when available.
- A video we can't fetch (UNPLAYABLE/proxy-down) gets no title — but that video also can't be summarized, so the title-less set == the failure set.
- If we later want instant, proxy-free titles at queue-time, revisit with the YouTube Data API.
