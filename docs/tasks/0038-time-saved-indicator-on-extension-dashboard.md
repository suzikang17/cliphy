---
title: "Time saved indicator on extension dashboard"
status: done
owner: none
type: feature
completed: 2026-02-26
---

# Time saved indicator on extension dashboard

Full-stack videoDurationSeconds field from content script → popup → background → API → DB. Usage endpoint returns totalTimeSavedSeconds. UsageBar shows total time saved, QueueList shows per-item 'Saved Xm' badge. Shared formatTimeSaved + parseDurationToSeconds utils. Commits: 069fce7 (queue mgmt), c5f12d3 (time saved)

_Migrated from task-archive.md (CLIP-38, target Day 7)._
