---
date: 2026-02-18
title: "Use cached fixtures for CI eval, not live YouTube fetching"
category: Tech
revisit: false
---

# Use cached fixtures for CI eval, not live YouTube fetching

**Date:** 2026-02-18 · **Category:** Tech · **Revisit?** no

## Why this choice

YouTube blocks requests from GitHub Actions runner IPs. Video rodcdKuwH3o returned 'no captions' in CI but worked locally (67811 chars). Cached fixtures are deterministic and don't depend on YouTube availability.

## Options considered

1. Live fetching in CI (pass URL to GHA)
2. Cached fixtures only (pre-fetch locally, commit as JSON)
3. Proxy/VPN in CI (residential proxy to avoid IP blocks)

## Tradeoffs

New videos must be added locally with pnpm eval:add and committed. Can't test unknown videos from CI. But: deterministic results, no flaky tests, no external dependency.
