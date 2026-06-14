# Cliphy

YouTube video summarizer Chrome extension with queue system.

## Project structure

Monorepo with pnpm workspaces:

- `apps/extension/` — Chrome extension (React + WXT)
  - `entrypoints/` — background, content scripts, popup (WXT convention)
  - `lib/` — API client, auth, storage helpers
- `apps/server/` — Backend API (Hono, deployed to Vercel)
- `packages/shared/` — Shared types & constants (`@cliphy/shared`)

## Tech stack

- **Extension:** Chrome MV3, React, WXT, TypeScript
- **Backend:** Hono, Supabase (Postgres + Auth), Stripe
- **AI:** Anthropic Claude API (Sonnet for summaries)
- **Testing:** Vitest
- **Monorepo:** pnpm workspaces
- **Hosting:** Vercel (serverless)
- **Node:** Managed by fnm, version pinned in `.nvmrc`

## Conventions

- TypeScript strict mode
- pnpm for package management
- Prettier for formatting (pre-commit hook)
- ESLint flat config
- Commit directly to main (solo dev)
- Commit messages: imperative mood, concise
  (e.g. "add queue endpoint" not "added queue endpoint")
- Use worktrees only for parallel sessions (separate tabs). Rebase onto main, fast-forward merge, push when done.
- Use `browser.*` API in extension code (WXT auto-polyfills, not `chrome.*`)

## Commands

- `pnpm dev` — Web app + local API server (port 5173 + 3001)
- `pnpm dev:prodApi` — Web app against prod API (cliphy.app)
- `pnpm dev:all` — Web app + API server + extension
- `pnpm dev:server` — API server only (port 3001)
- `pnpm dev:extension` — Build extension in watch mode (output: `apps/extension/.output/chrome-mv3`). Load unpacked in Chrome via `chrome://extensions`.
- `pnpm dev:mobile` — Expo dev client
- `pnpm build:web` — Build web app for production
- `pnpm build:extension` — Build extension for production
- `pnpm build:server` — Build server
- `pnpm lint` — ESLint
- `pnpm format` — Prettier
- `pnpm test:unit` — Unit tests (Vitest)
- `pnpm test:smoke` — Live API smoke tests (requires env vars)

## Project context (docs/)

All project context lives as plain markdown in `docs/` — start at [`docs/INDEX.md`](docs/INDEX.md). This repo is the source of truth; the old Notion workspace is a read-only archive (migrated 2026-06-07). Do **not** write to Notion.

- **Decisions:** `docs/decisions/` — one ADR file per decision (+ `index.md`). Log architectural/tooling choices here.
- **Devlog:** `docs/devlog/` — one dated file per session (+ `index.md`).
- **Tasks:** `docs/tasks/` — one file per task (status/owner frontmatter, kanban computed); capture lines in `docs/BACKLOG.md`, promoted when real.
- **Services & cost:** `docs/providers.md` — update whenever a service/provider is added, removed, or changed.
- **Architecture & ops:** `docs/architecture.md`.

## Workflow

### Session flow

1. Pick a task from `docs/tasks/` (open + owner: human/ai; see `docs/tasks/index.md`) at start of session
2. Build → verify it works → commit and push
3. Hit an issue? Research it, understand the "why", then fix — don't just patch blindly
4. When making a tech choice, check what's industry standard before committing to it
5. Switch tools early if something's wrong — don't accumulate tech debt on stubs
6. Commit after each logical chunk, not at the end
7. When a task is finished, set its file's `status: done` + `completed: <date>`, append a `## Work log` (summary + commit hashes), and run `lore reindex task`
8. Capture discovered work as a line in `docs/BACKLOG.md` (or promote straight to a task file if it's immediately real)
9. Log a devlog entry in `docs/devlog/` at end of session (what got done, decisions, issues hit)

### Sequencing

- Build first, then verify, then commit — never commit without testing
- When something breaks: understand root cause → research options → decide → fix → log what happened
- Log decisions and issues as they happen, not retroactively
- If a tool choice is wrong, switch immediately while cost is low — don't plan to migrate "later"
- Use branches only for risky experiments you might revert

### Communication style

- Keep responses concise — bullets over paragraphs
- Explain the "why" behind tools and decisions, not just the "what"
- When presenting options, include what's industry standard and tradeoffs
- Don't over-explain things that are working — focus on what needs attention

## Agent queue

Tasks in `docs/tasks/` with `status: open, owner: ai` are queued for the agent (see `/work-queue`):

1. Pick up the task; work it as normal session work.
2. Append a `## Work log` to the task body: what was done, commits, decisions.
3. On completion set `ai_run: true`, `owner: human` (hands it to Review & QA), run `lore reindex task`, commit.
4. If stuck: `status: blocked` + a `## Blocked on` note.

## Auto-logging

After any noteworthy event, automatically log it to the `docs/` markdown without being asked.
Use `/devlog` for a full session summary at the end.

**Log to `docs/devlog/` when:**

- A task is completed
- A bug is hit and fixed
- A tool/dependency is switched (e.g., CRXJS → WXT, nvm → fnm)
- A workaround is applied
- Something unexpected is learned

**Add a new ADR to `docs/decisions/` when:**

- A tech choice is made between alternatives
- An architectural pattern is chosen
- A tool is adopted or rejected

Keep entries concise. Include what happened, why, and what to remember.

**Lore doc format:** Before writing any lore doc (devlog, task, decision, etc.), read `docs/.lore/types/<type>.schema.yaml` and follow its `prompt` field for structure and style.

## Troubleshooting

- Node version error → fnm should auto-switch via `.nvmrc`. If not: `fnm use 22`
- Native module errors after Node update → nuke `node_modules` + `pnpm-lock.yaml` and `pnpm install`
