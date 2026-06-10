---
title: "Prompt tuning with real videos"
status: done
owner: none
type: feature
completed: 2026-03-03
---

# Prompt tuning with real videos

Implemented prompt tuning system with Promptfoo. A/B comparison of prompt variants with LLM-as-judge scoring on 4 dimensions (accuracy, conciseness, actionability, timestamp quality). Sonnet judge by default, Opus via --judge flag. Includes tune.ts wrapper with --category filtering. Commits: d429682, e31da64, 320f0e9

_Migrated from task-archive.md (CLIP-23, target Day 10)._
