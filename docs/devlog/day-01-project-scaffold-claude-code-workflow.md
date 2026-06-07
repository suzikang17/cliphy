---
day: 1
date: 2026-02-16
phase: MVP
mood: 🔥 Locked In
hours: 3
tags: [frontend, backend]
published_to: [None Yet]
public: false
title: "Day 1 — Project scaffold + Claude Code workflow"
---

## What got done

- Scaffolded pnpm monorepo with three workspaces (`apps/extension`, `apps/server`, `packages/shared`)
- Chrome extension: React + Vite + CRXJS, MV3 manifest, popup UI, background worker, content script, API/auth/storage helpers
- Server: Hono with route stubs (auth, queue, summaries, usage, billing), middleware, service stubs, Vercel config
- Shared package: TypeScript types (`Summary`, `User`, `QueueItem`, `UsageInfo`) and constants (plan limits, API routes)
- Configured TypeScript strict mode, ESLint flat config, Prettier, Husky + lint-staged pre-commit hooks
- Installed Vitest, added `test` script
- Added README with setup instructions
- Created `CLAUDE.md` with project context, conventions, and Notion collection IDs
- Pushed to private GitHub repo (`suzikang17/cliphy`)
- Tested full Notion workflow: pull task → build → commit → push → mark done

## Decisions made

- **pnpm workspaces** over flat structure — shared types as a proper workspace package (`@cliphy/shared`) instead of duplicating across apps
- **Hono** over Express — lighter, better TypeScript support, native Vercel compatibility
- **CRXJS → WXT** — hit CORS bug on day 1 with CRXJS + Vite 5.4.12+, researched the landscape, switched to WXT (industry standard) while everything was still stubs
- **nvm → fnm** — auto-switches Node version via `.nvmrc` on `cd`, no more manual `nvm use`

## Issues hit

- **CRXJS CORS bug** — Vite 5.4.12+ added WebSocket token validation that breaks `chrome-extension://` origins connecting to [localhost](http://localhost/) dev server. Applied workaround (`server.cors.origin: "*"`, `legacy.skipWebSocketTokenCheck: true`) then decided to migrate to WXT instead
- **Node version mismatch** — pnpm requires Node 18+, default shell had Node 16. Added `.nvmrc` then later switched to fnm for auto-switching
- **Rollup native module error** — after switching from nvm (Node 22.21.1) to fnm (Node 22.22.0), native binaries didn't match. Fixed by nuking `node_modules` + `pnpm-lock.yaml` and reinstalling
- **Port 3000 conflict** — Hono server wouldn't start because previous test left process on port 3000. Killed process, verified health endpoint returns `{"status":"ok"}`

## Tasks completed

- ✅ Project setup and dev tooling
- ✅ Set up Claude Code workflows

## What was set up for future sessions

- Auto-logging convention in [CLAUDE.md](http://claude.md/) — Claude will log to Notion devlog/decisions log after noteworthy events automatically
- `/devlog` skill created for end-of-session summaries
- CI pipeline task created in Notion (lint, typecheck, test via GitHub Actions)
- [CLAUDE.md](http://claude.md/) updated with workflow preferences, sequencing patterns, communication style, and troubleshooting tips

## Commits

- `753086c` — Initial project scaffold
- `f4b63cb` — [CLAUDE.md](http://claude.md/), ESLint, Prettier, pre-commit hooks
- `481d278` — README and Vitest setup
- `2ae204b` — Migrate extension from CRXJS to WXT
- `03c3925` — Auto-logging conventions and /devlog skill

---

## Session 2: Task board housekeeping

- Analyzed dependencies between Day 1 and Day 2 Notion tasks
- Marked Day 1 tasks as Done: "Set up Chrome extension boilerplate (MV3)" and "Set up backend API skeleton (Node + Supabase)"
- Added "Blocked By" relation property to Task Board — self-referencing relation for task dependencies
- Wired up dependencies:
  - Wire up Supabase tables (Day 3) → blocked by Set up Supabase project
  - Google OAuth via Supabase (Day 8) → blocked by Set up Supabase project
- Added dependency notes to tasks for extra context

### Issues hit

- **Notion API 500 on self-referencing dual relations** — tried to create "Blocked By" + "Blocks" as a dual property (auto-populating reverse). Notion API returns 500 for self-referencing dual relations. Workaround: create as single_property via API, then enable "Show on related database" toggle manually in Notion UI to get the "Blocks" reverse column

### What to remember

- Notion API can’t create self-referencing dual relations — always do this manually in the UI
- Keep task status current as work happens, don’t batch status updates
