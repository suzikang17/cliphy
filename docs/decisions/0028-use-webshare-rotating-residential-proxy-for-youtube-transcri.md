---
date: 2026-02-23
title: "Use Webshare rotating residential proxy for YouTube transcript fetching"
category: Tech
revisit: false
---

# Use Webshare rotating residential proxy for YouTube transcript fetching

**Date:** 2026-02-23 · **Category:** Tech · **Revisit?** no

## Why this choice

YouTube strips captions from all major cloud provider IPs. Webshare is industry standard for this — integrated into youtube-transcript-api, cheapest option. ~50KB per transcript = ~20,000 transcripts per GB. undici ProxyAgent is built into Node.js, no new runtime dependency.

## Options considered

1. Webshare rotating residential proxy (~$3.50/GB)
2. BrightData residential proxy (more expensive, more features)
3. Python youtube-transcript-api subprocess (works from datacenter IPs for some videos)
4. Move transcript fetching back to extension (user's residential IP)

## Tradeoffs

Adds external service dependency and per-GB cost. Falls back to direct fetch when env vars not set (local dev still works). Need to verify dispatcher option works in Vercel's Node.js 20.x runtime.
