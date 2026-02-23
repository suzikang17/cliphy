# Brutalist-Lite Popup UI Redesign

## Goal

Improve the extension popup's information density and visual style with a brutalist-lite aesthetic: square corners, thick borders, bold typography, monospace metadata, compact layout.

## Visual Changes

| Element       | Current                     | New                                                  |
| ------------- | --------------------------- | ---------------------------------------------------- |
| Border radius | `rounded-lg`                | `rounded-none` (square)                              |
| Borders       | `border border-gray-200`    | `border-2 border-black`                              |
| Typography    | Regular weight, system font | Bolder headings, monospace for metadata              |
| Status tags   | Emoji + capitalized text    | Uppercase bold bordered tags: `[PENDING]` `[FAILED]` |
| Progress bar  | Thin rounded (2px)          | Thick square block (4-6px)                           |
| Buttons       | Rounded blue fill           | Square, thick black border, bold text                |
| Spacing       | Large gaps                  | Tighter, compact queue                               |

## Information Density Fixes

- Queue items show `videoTitle` (already on Summary type) with videoId monospace fallback
- Channel + duration as compact metadata
- Relative timestamps ("2m ago")
- Reduced vertical padding between queue items

## Unchanged

- Layout structure: header -> usage -> video card -> queue
- Tailwind-only (no new deps)
- Grayscale + blue accent palette
- Component structure (App, VideoCard, UsageBar, QueueList)

## Implementation: 3 Parallel Worktrees

### Worktree 1: Global style pass

- Square corners, thick borders, bolder typography across all components
- Update App.tsx header/sign-in, button styles

### Worktree 2: QueueList density

- Show videoTitle with videoId fallback
- Compact layout, uppercase bold status tags
- Relative time display

### Worktree 3: VideoCard + UsageBar polish

- Monospace metadata in VideoCard
- Block progress bar in UsageBar
- Square button styling in VideoCard
