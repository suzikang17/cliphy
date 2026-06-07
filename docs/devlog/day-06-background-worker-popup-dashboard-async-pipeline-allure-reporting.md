---
day: 6
date: 2026-02-21
phase: MVP
mood: 😎 Smooth
hours:
tags: [backend]
published_to: []
public: false
title: "Day 6 — Background worker, popup dashboard, async pipeline, Allure reporting"
---

Two major chunks today: shipped a GHA live API smoke test, then designed and implemented the background service worker for queue processing. Extension can now queue videos and generate summaries via the API, with context menu support on YouTube pages.

Also added Allure test reporting — CI now generates HTML dashboards and deploys to GitHub Pages for test trend tracking.

Session 2: Designed and built the full popup dashboard — three UI surfaces (popup, side panel, full-tab summaries page). Used Subagent-Driven Development with spec compliance + code quality reviews after each task batch. 12 commits, all CI green.

## What got done

- Built GHA live API smoke test — creates temp user, tests 9 endpoints, cleans up (`fc45061`)
- Converted smoke test to Vitest, split `test:unit` / `test:smoke` (`6be09a0`, `2ed3539`, `f61038f`)
- Moved `extractVideoId` to `@cliphy/shared` for extension reuse (`d2b4708`)
- Added `POST /api/queue/:id/process` endpoint — fetches transcript, calls Claude, updates row (`a026342`)
- Added `processQueueItem` to extension API client (`7197047`)
- Added `contextMenus` permission (`927a9d2`)
- Rewrote background service worker — `queueAndProcess()` flow, context menu on YouTube watch pages, auth delegation (`05e0fa7`)
- Design doc + implementation plan (`bb8a5d5`)

### Session 2: Popup Dashboard

- Designed popup dashboard with 3 surfaces: popup (360px), side panel (~400px), full-tab summaries page (`a9421a9`)
- Added Tailwind CSS v4 to extension via `@tailwindcss/vite` plugin (`0caca59`)
- Rewrote popup auth screens with Tailwind classes (`e737f85`)
- Added current video card with Add to Queue button (`6dcb178`)
- Added queue list with status icons + usage bar (`7cfc997`)
- Fixed empty state text and fetchUser silent failure from code review (`2246332`)
- Added `SEEK_VIDEO` message type for clickable timestamps (`c2745a4`)
- Created side panel entrypoint for reading summaries alongside YouTube (`5f58689`)
- Fixed content script `return true` leak from code review (`7d5e10c`)
- Created full-tab summaries page as primary browsing experience (`ff84922`)
- Wired popup links to side panel with fallback to full tab (`190b21e`)
- Fixed side panel open race condition: set path before opening (`d9983a0`)
- Fixed implicit `any` types in background and content script listeners (`edde838`)

## Decisions

- **Synchronous processing (MVP)**: background worker calls queue then process sequentially. Async pipeline deferred.
- **No batch tabs**: deferred to async processing milestone (service worker could get killed mid-batch)
- **No notifications**: will rethink later
- **Tailwind CSS v4 over v3**: Uses `@tailwindcss/vite` plugin (not PostCSS). No `tailwind.config` needed.
- **Three UI surfaces**: Popup for quick-add, side panel for reading alongside YouTube, full-tab page as primary experience. Product philosophy: keep users away from YouTube distractions.
- **Subagent-Driven Development**: Fresh subagent per task batch + spec compliance review + code quality review. Caught 4 real issues across reviews.
- **`POST /:id/process`\*\*** over PATCH\*\*: dedicated endpoint that handles full lifecycle (transcript → Claude → DB update) server-side

## Issues

- Lint-staged stash conflict during subagent commits — Task 2 commit was lost (`800b03c`), had to re-commit as `a026342`
- Prettier failed on markdown docs — needed `prettier --write` on plan files
- `pnpm test` script was renamed to `test:unit` by a subagent mid-session — had to update ship skill

## What to remember

- GHA secrets are per-repo by default
- `return true` in `runtime.onMessage` keeps message port open for async `sendResponse`
- Service worker has no persistent memory — API is source of truth
- `documentUrlPatterns: ["*://*.youtube.com/watch*"]` limits context menu to YouTube watch pages
- `browser.runtime.onInstalled` is where you register context menus (not top-level)
- `browser.sidePanel.setOptions()` must be called **before** `sidePanel.open()` — otherwise the panel renders with the default path before the URL update takes effect
- WXT auto-generates `side_panel.default_path` manifest entry from the `entrypoints/sidepanel/` directory name
- WXT re-exports `webextension-polyfill` types from `wxt/browser` — use `import type { Runtime, Menus, Tabs } from 'wxt/browser'` for explicit listener parameter types
- `fetchUser` must throw on non-ok response, otherwise auth failure silently shows sign-in screen with no error message
- Pre-existing bug: `isAuthenticated()` in `background.ts` ADD_TO_QUEUE handler missing `await` — auth gate is dead code (to fix later)

---

## Commits

- `fc45061` — add GHA live API smoke test workflow
- `6be09a0` — convert smoke tests to Vitest, split test scripts
- `2ed3539` — fix test:smoke being excluded by vitest config
- `f61038f` — fix smoke test env loading with dotenv
- `d2b4708` — move extractVideoId to @cliphy/shared
- `a026342` — add POST /api/queue/:id/process endpoint
- `7197047` — add processQueueItem to extension API client
- `927a9d2` — add contextMenus permission to extension manifest
- `05e0fa7` — wire up background worker with queue, process, and context menu
- `bb8a5d5` — add background worker design and plan docs, update ship skill
- `66228f7` — add async processing architecture design doc
- `ecdfd5c` — add Allure test reporting with GitHub Pages deploy
- `171a0b2` — add Allure reporting to smoke test workflow
- `c955029` — exclude dist/ from vitest, add Allure semantic labels to all tests
- `6150c8b` — improve Allure label naming to follow best practices
- `ac150cb` — fix Allure suite hierarchy with nested describes, add categories and env info
- `21a6185` — add worktree convention to [CLAUDE.md](http://claude.md/)
- `87f317d` — add per-run Allure reports with ci/ subfolder
- `36b823d` — remove Allure reporting from smoke test workflow
- Added Allure test reporting — `allure-vitest` reporter + CI steps to generate & deploy HTML report to GitHub Pages (`ecdfd5c`)

### Session 2: Popup Dashboard

- `a9421a9` — add popup dashboard and summary viewer design doc
- `18ec858` — add popup dashboard implementation plan
- `0caca59` — add Tailwind CSS to extension
- `e737f85` — rewrite popup auth screens with Tailwind
- `6dcb178` — add current video card to popup with add-to-queue
- `7cfc997` — add queue list and usage bar to popup
- `2246332` — fix empty state instruction text and fetchUser silent failure
- `c2745a4` — add SEEK_VIDEO message for clickable timestamps in side panel
- `5f58689` — add side panel entrypoint for reading summaries
- `7d5e10c` — remove unnecessary return true from content script message listener
- `ff84922` — add full-tab summaries page
- `190b21e` — wire popup links to side panel and full-tab summaries
- `d9983a0` — fix side panel open race: set path before opening
- `edde838` — fix implicit any types in background and content script listeners

### Session 3: Async Pipeline

- `fae8f91` — add Inngest async pipeline and Supabase Realtime subscription

---

### Task: GHA live API smoke test

Built end-to-end smoke test for deployed API. Auto-generates temp user per run (3 Supabase secrets only). 9 test scenarios covering health, auth, queue CRUD, usage, summaries. Runs via `workflow_dispatch` in GitHub Actions.

### Task: Background service worker

Designed and implemented the MVP background worker. Extension popup sends `ADD_TO_QUEUE` message → background calls `POST /api/queue` then `POST /api/queue/:id/process` → returns completed summary. Context menu "Add to Cliphy" on YouTube watch pages. Auth delegation (SIGN_IN/SIGN_OUT) already existed. No in-memory state — server is source of truth.

### Task: Allure test reporting

Added `allure-vitest` reporter to Vitest config. CI workflow now generates Allure HTML report with history (last 30 runs) and deploys to GitHub Pages via `gh-pages` branch. Manual setup needed: enable workflow write permissions and configure Pages to deploy from `gh-pages`.

Followed up with: added Allure reporter to smoke test workflow, excluded `dist/` duplicates from vitest (89 → 47 tests), added semantic labels (epic/feature/story) to all tests via `allure-js-commons`. Made repo public to enable GitHub Pages. Report live at [https://suzikang17.github.io/cliphy/](https://suzikang17.github.io/cliphy/).

Fixed Allure Suites tab showing flat names by replacing manual `parentSuite()` calls with nested `describe()` blocks. Added reporter config for categories (Infrastructure/Product defects/Test defects), `environmentInfo` (node, OS), `layer` labels (unit/e2e), and `severity` markers on critical flows (`ac150cb`).

Set up per-run Allure reports — each CI run gets its own URL at `/ci/<run-number>/`, with `/ci/` auto-redirecting to latest. Removed Allure from smoke test workflow (terminal output only). Cleaned up old gh-pages structure. Established worktree convention: use only for parallel sessions, rebase onto main + fast-forward merge (`21a6185`, `87f317d`, `36b823d`).

### Task: Popup Dashboard & Summary Viewer

Designed and implemented three UI surfaces using Subagent-Driven Development (9 tasks, each with spec + code quality review):
