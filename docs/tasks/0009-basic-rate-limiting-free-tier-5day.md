---
title: "Basic rate limiting (free tier: 5/day)"
status: done
owner: none
type: feature
completed: 2026-02-20
---

# Basic rate limiting (free tier: 5/day)

GET /api/usage returns {used, limit, plan, resetAt}. Queue add uses atomic increment_daily_count(). Batch caps to remaining capacity. Free: 5/day, Pro: 100/day. Handles day reset. 4 tests. Commit: e322e64.

_Migrated from task-archive.md (CLIP-9, target Day 5)._
