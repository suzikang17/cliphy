---
date: 2026-02-17
title: "Atomic increment_daily_count() for rate limiting"
category: Tech
revisit: false
---

# Atomic increment_daily_count() for rate limiting

**Date:** 2026-02-17 · **Category:** Tech · **Revisit?** no

## Why this choice

Application-level check has a TOCTOU race: two simultaneous requests can both read count=4, both pass limit=5 check, both increment. The DB function does check+increment in one UPDATE — Postgres row-level locking serializes concurrent requests.

## Options considered

1. Read count → check limit → increment (application-level)
2. Single atomic UPDATE with WHERE clause (DB-level function)

## Tradeoffs

Rate limit logic lives in a DB function rather than application code. Backend calls select increment_daily_count(user_id, limit) instead of managing it directly.
