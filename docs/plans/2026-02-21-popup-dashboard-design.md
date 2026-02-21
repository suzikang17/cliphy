# Popup Dashboard & Summary Viewer Design

## Summary

Three UI surfaces for the extension: a compact popup for quick-add and queue status, a side panel for reading summaries alongside YouTube, and a full-tab page as the primary summary browsing experience. The core idea: keep users away from YouTube by giving them a distraction-free place to consume video summaries.

## Product Philosophy

Cliphy saves users time and prevents YouTube distractions. The full-tab summaries page is the **primary interface** — users shouldn't need to be on YouTube to get value from their queued videos. The side panel and popup are secondary surfaces for when they happen to be on YouTube.

## Three Surfaces

### 1. Popup (360px) — Quick Actions

Compact utility for queueing videos and glancing at status.

- **Header:** "Cliphy" + user email + sign out
- **Current Video Card:** shown only on YouTube watch pages. Video title, channel, "Add to Queue" button. Shows "Already queued" or "Processing..." if applicable.
- **Queue List:** recent items sorted newest first. Status icons per item:
  - Completed: link icon, click opens side panel to that summary
  - Pending/processing: spinner
  - Failed: error icon + message
- **Footer:** usage bar ("2/5 summaries today") + "View All" link to full tab

### 2. Side Panel (~400px) — Read Alongside Video

Opens alongside the YouTube page when clicking a completed summary in the popup. Requires `sidePanel` permission.

- Video title at top
- Full summary text
- Key points (bulleted list)
- Timestamps (clickable — seeks YouTube player to that time via content script)
- Navigation to browse other summaries within the panel
- "Pop out" link to open summary in the full tab

### 3. Full Tab (`summaries.html`) — Primary Experience

The main product interface. A full-width page for browsing, reading, and managing all summaries.

- List/card view of all summaries with status indicators
- Click to expand and read full summary, key points, timestamps
- Deep-linkable via hash routes (`#/summary/{id}`)
- Auth check on load (same `getAccessToken()` flow)
- Usage stats visible

## Styling

Tailwind CSS across all three surfaces. Shared component library (status badges, summary cards, usage bar) reused in popup, side panel, and full tab.

## Data Flow

- **Popup open:** fetch `GET /api/queue` + `GET /api/usage` in parallel
- **"Add to Queue":** send `ADD_TO_QUEUE` message to background worker
- **Current video info:** send `GET_VIDEO_INFO` message to content script
- **Click completed item in popup:** `chrome.sidePanel.open()` + pass summary ID
- **Click timestamp in side panel:** message to content script -> `video.currentTime = seconds`
- **"View All" link:** `browser.tabs.create({ url: browser.runtime.getURL("/summaries.html") })`

## States

| State              | Popup                         | Side Panel         | Full Tab             |
| ------------------ | ----------------------------- | ------------------ | -------------------- |
| Not authenticated  | Sign-in screen                | Sign-in screen     | Sign-in screen       |
| Not on YouTube     | No video card, queue + usage  | N/A                | Full experience      |
| API unreachable    | "Couldn't load" + retry       | Same               | Same                 |
| Empty queue        | "Queue your first video"      | "No summaries yet" | Same                 |
| Rate limit reached | Add button disabled + message | N/A                | Usage bar shows full |

## Permissions

Add `sidePanel` to existing permissions in `wxt.config.ts`.

## WXT Entrypoints

- `entrypoints/popup/` — existing, rewrite with Tailwind + new components
- `entrypoints/sidepanel/` — new, side panel React app
- `entrypoints/summaries/` — new, full tab React app

## Deferred

- Search/filter summaries (full tab)
- Paste URL to add (popup)
- Keyboard shortcuts
- Export summaries
