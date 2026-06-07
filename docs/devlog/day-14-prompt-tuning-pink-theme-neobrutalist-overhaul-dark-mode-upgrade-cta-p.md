---
day: 14
date: 2026-03-06
phase: Post-Launch
mood: 🔥 Locked In
hours:
tags: [UI, prompt-eng]
published_to: []
public: false
title: "Day 14 — Prompt Tuning, Pink Theme, Neobrutalist Overhaul, Dark Mode & Upgrade CTA Polish"
---

Quick session focused on polishing the summary UI labels and bullet styling.

## What got done

- Renamed summary sections for cleaner UX:
  - "Quick Take" → **TL;DR**
  - "Key Takeaways" → **Highlights**
  - "Timestamps" → **Jump To**
- Replaced emoji bullet points in dynamic context section with plain `•` bullets (consistent with Highlights section)
- Emoji icon now only appears in the context section header, not repeated on every item
- Fixed pre-existing lint errors (unused imports in sidepanel/App.tsx and summaries/App.tsx)
- Updated markdown and plain-text export formats to match new labels

## What to remember

- Section labels: TL;DR, Highlights, Jump To, and dynamic context section title
- Context section uses `•` bullets like Highlights; emoji only in header
- Anchor IDs: `#tldr`, `#highlights`, `#jump-to`, `#context-section`

---

## Commits

- `b7dc22c` rename summary sections: TL;DR, Highlights, Jump To; use plain bullets for context section

---

# Session 2: UI Polish — Pink Theme, Neobrutalist Overhaul, Inline Current Video

Massive sidepanel UI overhaul — unified pink/neon color theme, neobrutalist component styling, inlined current video into queue list, and fixed several UX bugs.

## What got done

- **Inline current video in queue list** — removed standalone VideoCard, current video now renders as highlighted first item in queue with neon-400 border accent (`c48ddb4`)
- **Pink theme unification** — audited all components for off-theme colors (green, purple, indigo) and replaced with neon/pink variants (`c48ddb4`)
- **Neobrutalist usage bar** — redesigned progress bar with border-2, shadow-brutal-sm, all stats inline (used/limit, time saved with clock icon, Pro user/Upgrade) (`c48ddb4`)
- **Button styling unification** — Back, View Summary, Add to Queue, View All buttons all use matching pink pill style (bg-neon-100 text-neon-800) (`c48ddb4`)
- **Skeleton loading state** — added skeleton card for current video with real thumbnail preview while title loads (`c48ddb4`)
- **Cross-video timestamp navigation** — clicking timestamp when on different video navigates to correct video at that time (`c48ddb4`)
- **Dismissed video tracking** — fixed bug where removing a failed video would re-show it as "Add to Queue" via ref-based tracking (`c48ddb4`)
- **Pro badge in top bar** — "Queue ✦" pink text for Pro users
- **Deleted VideoCard.tsx** — no longer needed after inlining into QueueList

## Decisions

- **Pro indicator placement**: tried ~10 locations (superscript, badge, email button, dropdown, centered). Landed on: inline "Pro user" text inside usage bar + pink "Queue ✦" in top bar. Free users get "Upgrade" link in usage bar.
- **Section naming**: tried renaming TL;DR to "Quick Take" but reverted — TL;DR is more recognizable
- **Emojis in section headers**: tried adding 💡✨⏱️ after section titles, decided they didn't match the neobrutalist branding — removed

## Issues

- **Content script SPA navigation**: YouTube SPA nav sends videoId immediately with empty title, then polls for DOM update. Had to add title check before setting video state so skeleton stays visible until title populates.
- **Failed video removal re-appearing**: removing a failed summary still showed the video as currentVideo "Add to Queue" item. Fixed with `dismissedVideoRef` that tracks the dismissed videoId.
- **Chrome Side Panel API limitation**: no way to toggle/close side panel programmatically — known Chrome limitation.

## What to remember

- `border-2 shadow-brutal-sm` is the standard neobrutalist weight for interactive elements
- Pink pill button recipe: `bg-neon-100 text-neon-800 dark:bg-neon-900 dark:text-neon-200 border-2 border-(--color-border-hard) rounded-md shadow-brutal-sm hover:shadow-brutal-pressed press-down`
- Progress bar fill uses `bg-neon-200` (light enough for text readability), `bg-red-300` at limit
- Badge color for extension icon: `#e6007e` (neon-600 pink)

## Commits

- `c48ddb4` — overhaul sidepanel UI: pink theme, neobrutalist polish, inline current video

---

# Session 3: Dark Mode Fixes, Upgrade CTA Unification, View in Cliphub

Fixed muddy dark mode colors, unified the upgrade flow, and added a "View in Cliphub" link in the sidepanel detail view.

## What got done

- **Dark mode outline buttons** — all pink accent buttons now use transparent bg + pink text (`neon-400`) in dark mode instead of muddy filled backgrounds (`613a8ff`)
- **Upgrade CTA unification** — single upgrade banner above queue for free users ("✦ Unlock 100 summaries/month with Pro"), contextual "✦ Unlock with Pro" button on current video when at limit, inline "Upgrade" link in usage bar. Never two CTAs stacked. (`613a8ff`)
- **Removed heavy upgrade CTA** — deleted the full-width "Upgrade — get 100/mo" button from below usage bar, replaced with slim banner (`613a8ff`)
- **View in Cliphub link** — added `View in Cliphub ↗` text link in sidepanel detail view metadata row (after channel · duration) (`613a8ff`)
- **Card click vs icon click separation** — card click navigates in sidepanel, external link icon opens in new tab with `stopPropagation` (`613a8ff`)
- **Softened color palette** — settled on dusty rose pink after multiple iterations, removed red usage bar clash (`613a8ff`)
- **UpgradePrompt themed** — replaced amber/orange gradient with pink theme + neobrutalist border/shadow (`613a8ff`)
- **UsageBar simplified** — removed `useState`, `loading` state, big CTA button; just the progress bar with inline Upgrade link

## Decisions

- **Dark mode button style**: outline (transparent bg + colored text) vs filled bg. Outline wins — filled neon colors look muddy/brownish on dark surfaces.
- **Upgrade CTA placement**: tried bottom bar, top bar badge, card interstitial. Landed on banner above queue (always visible for free users) + contextual button on current video at limit.
- **Usage bar at-limit color**: removed red fill — clashes with pink theme. Same pink fill always, text communicates usage.

## What to remember

- Dark mode pink button recipe: `dark:bg-transparent dark:text-neon-400 border-2 border-(--color-border-hard)`
- `onOpenInTab` prop on SummaryDetail for the "View in Cliphub" link
- `atLimit` + `onUpgrade` props on QueueList for contextual upgrade button
- Never use `dark:bg-neon-900` for button fills — looks muddy brown

## Commits

- `613a8ff` — polish UI: dark mode fixes, upgrade CTA unification, View in Cliphub link
