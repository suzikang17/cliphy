---
title: "Summary storage and retrieval endpoints"
status: done
owner: none
type: feature
completed: 2026-02-20
---

# Summary storage and retrieval endpoints

GET /api/summaries (paginated, status filter), GET /api/summaries/search?q= (ILIKE), GET /api/summaries/:id, DELETE /api/summaries/:id (soft-delete via deleted_at + partial index). Free: 7-day history, Pro: unlimited. 9 tests. Commit: e322e64.

_Migrated from task-archive.md (CLIP-8, target Day 5)._
