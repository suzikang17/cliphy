---
date: 2026-02-17
title: "Unified summaries table (queue + result in one table)"
category: Tech
revisit: false
---

# Unified summaries table (queue + result in one table)

**Date:** 2026-02-17 · **Category:** Tech · **Revisit?** no

## Why this choice

A queue item IS a summary in progress. Separate tables would mean copying data between them on completion. Single table with status enum is simpler, fewer joins, and the TypeScript types collapse from QueueItem+Summary into just Summary.

## Options considered

1. Separate queue_items and summaries tables with FK
2. Single summaries table with status lifecycle (pending → processing → completed/failed)

## Tradeoffs

Table has nullable fields (summary_json, error_message) that only apply in certain states. Acceptable for this scale.
