---
date: 2026-02-18
title: "Use Claude Sonnet 4.6 for summaries"
category: Tech
revisit: false
---

# Use Claude Sonnet 4.6 for summaries

**Date:** 2026-02-18 · **Category:** Tech · **Revisit?** no

## Why this choice

Sonnet 4.6 is strictly better than 4.5 at the same price. 1M context window means even longest transcripts won't need truncation. Released day before we built the summarizer.

## Options considered

1. Sonnet 4.5 — proven stable, previous default
2. Sonnet 4.6 — released Feb 17, same pricing, 1M context, better reasoning
3. Haiku — cheaper but lower quality for structured summaries

## Tradeoffs

Brand new model (1 day old) could have undiscovered issues. Easy to revert — one constant change in summarizer.ts.
