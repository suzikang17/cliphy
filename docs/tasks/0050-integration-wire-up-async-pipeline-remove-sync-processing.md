---
title: "Integration: wire up async pipeline + remove sync processing"
status: done
owner: none
type: feature
completed: 2026-03-03
---

# Integration: wire up async pipeline + remove sync processing

After server Inngest + extension Realtime are both done: remove POST /api/queue/:id/process endpoint, remove API_ROUTES.QUEUE.PROCESS from shared constants, remove processQueueItem() from extension API client, simplify background worker queueAndProcess() to just addToQueue(), update/remove tests for deleted endpoint, verify full e2e flow. --- All done. Sync processing fully removed, Inngest handles everything.

_Migrated from task-archive.md (CLIP-50, target —)._
