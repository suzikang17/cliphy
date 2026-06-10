---
title: "Inject Summarize button into Youtube UI"
status: done
owner: none
type: feature
completed: 2026-04-18
---

# Inject Summarize button into Youtube UI

Completed Apr 18. ✅ Done: - Actions row button (icon + text, light/dark mode via --yt-spec CSS vars) - Video player overlay button - Home page thumbnail cards (ytd-rich-grid-media) - Sidebar injection (yt-lockup-view-model — new YouTube design system) - Lockup overlay stays on hover (inject into yt-lockup-view-model, not yt-thumbnail-view-model) - CORS fix: server allows chrome-extension:// and moz-extension:// origins - Extension context invalidation: safeSendMessage() guards stale runtime after reload - Unauthenticated user handling: toast with 'Sign in →' link - Rate limit / pro_required error handling with actionable toasts - Performance: single MutationObserver, skip querySelectorAll on leaf nodes - Hydration detection for lazy-loaded yt-lockup-view-model elements - Deferred scan (1.5s) on initial load for late-rendering thumbnails ❌ Intentionally dropped: - Three-dot menu injection: YouTube's new design system (yt-list-item-view-model / yt-sheet-view-model) is too fragile to inject into cleanly. Hover overlay is sufficient UX for sidebar.

_Migrated from task-archive.md (CLIP-101, target —)._
