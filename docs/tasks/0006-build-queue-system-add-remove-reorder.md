---
title: "Build queue system (add, remove, reorder)"
status: done
owner: none
type: feature
completed: 2026-02-20
---

# Build queue system (add, remove, reorder)

POST /api/queue (single add), POST /api/queue/batch (Pro-only, max 10), DELETE /api/queue/:id, GET /api/queue, GET /api/queue/:id. YouTube URL parsing (6 formats), duplicate detection, queue position. Rate limiting via atomic increment_daily_count(). 22 tests. Commit: e322e64.

_Migrated from task-archive.md (CLIP-6, target Day 5)._
