---
title: "Support multi languages"
status: done
owner: none
type: feature
completed: 2026-04-18
---

# Support multi languages

Allow users to receive summaries in their preferred language, regardless of the video's original language. What was built: - 20 supported languages (SUMMARY_LANGUAGES const in @cliphy/shared) - user_settings table (1:1 with users) stores summary_language preference - YouTube transcript always fetched in original language — Claude handles translation - Language-aware summary cache: keyed by (video_id, summary_language) - transcript_language stored on each summaries row for visibility - GET/PATCH /api/settings endpoints for reading/updating preference - Language selector (🌐) in extension sidepanel — optimistic render, syncs with server - summary_language passed through queue → Inngest → Claude pipeline Acceptance criteria: ✅ User selects language in sidepanel ✅ New summaries generated in selected language ✅ Language preference persisted server-side ✅ Transcript language recorded for debugging

_Migrated from task-archive.md (CLIP-103, target —)._
