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
- Use `browser.*` API in extension code (WXT auto-polyfills, not `chrome.*`)

## Commands

- `pnpm dev:extension` — Build extension in watch mode (output: `apps/extension/.output/chrome-mv3`). Load unpacked in Chrome via `chrome://extensions`.
- `pnpm dev:server` — Run API server in dev mode (port 3000)
- `pnpm --filter extension build` — Build extension for production
- `pnpm --filter server build` — Build server
- `pnpm lint` — ESLint
- `pnpm format` — Prettier
- `pnpm test:unit` — Unit tests (Vitest)
- `pnpm test:smoke` — Live API smoke tests (requires env vars)

## Notion integration

- Task Board: collection://2928b00e-9d27-47fc-a709-27cfd4b5c9e0
- Devlog: collection://20645fc8-887e-4b9e-a782-a45c888f9624
- Decisions Log: collection://796aacf9-23e4-4038-8bc6-c073afbeadd6
- Use Notion MCP tools to read/update tasks as you work
- Mark tasks Done when acceptance criteria are met
- Log architectural decisions in the Decisions Log

## Workflow

### Session flow

1. Pull task from Notion Task Board at start of session
2. Build → verify it works → commit and push
3. Hit an issue? Research it, understand the "why", then fix — don't just patch blindly
4. When making a tech choice, check what's industry standard before committing to it
5. Switch tools early if something's wrong — don't accumulate tech debt on stubs
6. Commit after each logical chunk, not at the end
7. Update task status in Notion when done (set Date Completed, add Notes)
8. Create follow-up tasks in Notion when new work is discovered
9. Log devlog entry at end of session (what got done, decisions, issues hit)

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

## Auto-logging

After any noteworthy event, automatically log it to Notion without being asked.
Use `/devlog` for a full session summary at the end.

**Log to Devlog when:**

- A task is completed
- A bug is hit and fixed
- A tool/dependency is switched (e.g., CRXJS → WXT, nvm → fnm)
- A workaround is applied
- Something unexpected is learned

**Log to Decisions Log when:**

- A tech choice is made between alternatives
- An architectural pattern is chosen
- A tool is adopted or rejected

Keep entries concise. Include what happened, why, and what to remember.

## Troubleshooting

- Node version error → fnm should auto-switch via `.nvmrc`. If not: `fnm use 22`
- Native module errors after Node update → nuke `node_modules` + `pnpm-lock.yaml` and `pnpm install`
