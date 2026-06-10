---
title: "Error handling (no transcript, long videos, API failures)"
status: done
owner: none
type: bug
completed: 2026-03-03
---

# Error handling (no transcript, long videos, API failures)

Implemented across 16 files. Error classification in Inngest worker (retryable vs non-retryable), 120s Claude timeout, RateLimitError + offline detection in extension, error messages shown in QueueList, videos >3hr blocked, transcript truncation warning for >100k chars. 13 unit tests added. Commit 568a857.

_Migrated from task-archive.md (CLIP-21, target Day 10)._
