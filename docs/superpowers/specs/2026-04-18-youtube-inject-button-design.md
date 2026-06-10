---
title: "YouTube UI Button Injection"
date: 2026-04-18
---

# YouTube UI Button Injection

**Date:** 2026-04-18
**Status:** Approved

## Overview

Inject a "Summarize" button directly into the YouTube UI so users can add videos to their Cliphy queue without opening the side panel. Button appears in two contexts: the video watch page and thumbnail cards on search/browse pages.

## Button Appearance

- Ghost pill button matching YouTube's Like/Share design language (`rgba(255,255,255,0.1)` background, white text, 18px border-radius)
- 14px butterfly logo as inline SVG (content scripts can't reference extension asset URLs in injected DOM) followed by "Summarize" label
- Smaller variant on thumbnail cards
- After successful queue add: transitions to "✓ Added", disabled for the session
- Hidden on live streams (`.ytp-live` detected)

## Injection Points

### Video Watch Page

- Target: `#actions` row (alongside Like, Share, More)
- Data source: existing `getVideoInfo()` — videoId from URL, title/channel/duration from DOM
- Trigger: on page load and on every `yt-navigate-finish` SPA event (already wired)
- Guard: skip if button already present

### Search & Browse Thumbnails

- Targets: `ytd-video-renderer`, `ytd-compact-video-renderer`, `ytd-grid-video-renderer`
- Data source: videoId from thumbnail `href`; title/channel/duration from card DOM
- Trigger: `MutationObserver` on `ytd-app` watching for new renderer elements as user scrolls
- Guard: `data-cliphy-injected` attribute on each card to prevent double-injection

## Implementation

All logic added to the existing `apps/extension/entrypoints/youtube.content.ts`. No new files needed.

### New functions

**`injectVideoPageButton()`**

- Waits for `#actions` to exist (polls with short interval, max ~3s)
- Creates button element, appends after existing action buttons
- On click: reads `getVideoInfo()`, sends `ADD_TO_QUEUE` message to background
- Handles response: success → mark added + show toast; error → show error toast

**`injectThumbnailButtons()`**

- Sets up `MutationObserver` on `ytd-app` for subtree changes
- On new renderer nodes: extracts videoId from `a#thumbnail[href]`, title from `#video-title`, channel from `ytd-channel-name`, duration from `#text.ytd-thumbnail-overlay-time-status-renderer`
- Skips cards missing videoId or already marked `data-cliphy-injected`
- On click: sends `ADD_TO_QUEUE` with available metadata

### Message flow

Reuses existing `ADD_TO_QUEUE` handler in `background.ts` — no background changes needed.

New message type: `OPEN_SIDEPANEL` (content → background) — background calls `browser.sidePanel.open({ windowId })`.

### Toast

- Single `div#cliphy-toast` injected into `document.body` at content script init
- Styled to appear bottom-right, above YouTube's UI (z-index: 9999)
- Success: "Added to queue · **Open Cliphy →**" — link sends `OPEN_SIDEPANEL`
- Error messages (see Error Handling below)
- Auto-dismisses after 3s with CSS fade-out transition

### Session state

- `const queuedVideoIds = new Set<string>()` in content script module scope
- On successful add: add videoId to set
- On button inject: check set → render as "✓ Added" if already queued
- Not persisted — cleared on page unload (acceptable for session UX)

## Error Handling

| Condition                     | Toast message                                                            |
| ----------------------------- | ------------------------------------------------------------------------ |
| Not signed in                 | "Sign in to Cliphy to summarize videos"                                  |
| Rate limit reached            | "Monthly limit reached · Upgrade →" (links to upgrade URL from response) |
| Pro required                  | "Pro plan required · Upgrade →"                                          |
| Live stream                   | Button hidden — no toast                                                 |
| Extension context invalidated | Silent fail                                                              |
| Unknown error                 | "Something went wrong — try again"                                       |

## Styling

Injected styles via a `<style>` tag added to `document.head` at content script init. Scoped with `.cliphy-*` prefix to avoid collisions with YouTube styles. No external CSS file — keeps injection self-contained.

## What's Not In Scope

- Persisting queued state across sessions (side panel already shows queue)
- Batch-add from search results (existing "All tabs" Pro feature covers this)
- Hover preview or summary peek on thumbnail hover
