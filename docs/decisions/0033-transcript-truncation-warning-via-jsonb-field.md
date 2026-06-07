---
date: 2026-03-03
title: "Transcript Truncation Warning via JSONB Field"
category: Tech
revisit: false
---

# Transcript Truncation Warning via JSONB Field

**Date:** 2026-03-03 · **Category:** Tech · **Revisit?** no

## Why this choice

Option 2. The truncated flag is part of the summary result, not the summary record. Storing it in the JSONB column avoids a DB migration, keeps the data co-located with the summary content, and the optional field is backward-compatible with existing rows.

## Options considered

1. Add truncated boolean column to summaries table
2. Add truncated field to SummaryJson type (stored in existing summary_json JSONB column)
3. Store truncation info in a separate metadata table

## Tradeoffs

Pro: Zero migration, backward-compatible, simple to thread through. Con: Not queryable via SQL (buried in JSONB), but we don't need to query on it — it's purely for UI display.
