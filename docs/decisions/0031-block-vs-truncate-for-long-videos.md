---
date: 2026-03-03
title: "Block vs Truncate for Long Videos"
category: Product
revisit: false
---

# Block vs Truncate for Long Videos

**Date:** 2026-03-03 · **Category:** Product · **Revisit?** no

## Why this choice

Option 3. Videos >3hr are unlikely to produce useful summaries — block them outright. But videos <3hr with long transcripts (dense content) should still work, just with a truncation warning so users know the summary is partial.

## Options considered

1. Truncate all long transcripts silently
2. Hard-block all long videos
3. Block >3hr, truncate >100k chars with warning

## Tradeoffs

Pro: Users get summaries for most videos, only truly unwieldy ones are blocked. Con: Truncated summaries may miss content from end of video. The 3hr threshold is arbitrary but matches YouTube's typical long-form content boundary.
