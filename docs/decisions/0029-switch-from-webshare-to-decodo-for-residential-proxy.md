---
date: 2026-02-26
title: "Switch from Webshare to Decodo for residential proxy"
category: Tech
revisit: false
---

# Switch from Webshare to Decodo for residential proxy

**Date:** 2026-02-26 · **Category:** Tech · **Revisit?** no

## Why this choice

Decodo free trial confirmed working with YouTube InnerTube + timedtext. Rotating residential IPs avoid the 429 rate limiting that datacenter IPs hit. 100MB free tier enough to validate before paying. Formerly Smartproxy — largest IP pool (55M+). Proxy code is provider-agnostic (single PROXY_URL env var).

## Options considered

1. Webshare free tier (datacenter, free) — blocked by YouTube timedtext 429
2. Webshare residential ($3.50/GB) — works but expensive
3. DataImpulse ($1/GB, non-expiring) — untested with YouTube
4. Decodo ($7.50/GB, 100MB free trial, 55M+ IP pool) — tested and confirmed working
5. SOAX ($2.20/GB, $1.99 trial)
6. IPRoyal ($7/GB, non-expiring)

## Tradeoffs

Most expensive per GB ($7.50 vs $1 DataImpulse). But confirmed working with YouTube, which is the only thing that matters for MVP. Can switch to cheaper provider later if costs matter.
