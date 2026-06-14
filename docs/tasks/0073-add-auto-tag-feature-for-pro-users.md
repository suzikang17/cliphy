---
title: "Add Auto-Tag feature for Pro users"
status: in_progress
spec: superpowers/specs/2026-03-10-auto-tag-design.md
owner: human
effort: medium
type: feature
platform: "extension, server"
---

# Add Auto-Tag feature for Pro users

Extension safety note (Apr 18): The extension (summaries/App.tsx) calls autoTagSummary and autoTagBulk via the API. Web app UI changes to the auto-tag feature are safe as long as the server endpoint response shapes (AutoTagSuggestion, BulkAutoTagResponse in @cliphy/shared) stay the same. Only changes to shared types would require an extension rebuild.

_Migrated from ROADMAP.md (CLIP-73, was 'In Progress')._
