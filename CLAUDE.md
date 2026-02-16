# Cliphy

YouTube video summarizer Chrome extension with queue system.

## Project structure

Monorepo with pnpm workspaces:

- `apps/extension/` — Chrome extension (React + Vite + CRXJS)
- `apps/server/` — Backend API (Hono, deployed to Vercel)
- `packages/shared/` — Shared types & constants (`@cliphy/shared`)

## Tech stack

- **Extension:** Chrome MV3, React, Vite, CRXJS, TypeScript
- **Backend:** Hono, Supabase (Postgres + Auth), Stripe
- **AI:** Anthropic Claude API (Sonnet for summaries)
- **Testing:** Vitest
- **Monorepo:** pnpm workspaces
- **Hosting:** Vercel (serverless)

## Conventions

- TypeScript strict mode
- pnpm for package management
- Prettier for formatting (pre-commit hook)
- ESLint flat config
- Commit directly to main (solo dev)
- Commit messages: imperative mood, concise
  (e.g. "add queue endpoint" not "added queue endpoint")

## Commands

- `pnpm dev:extension` — Run extension in dev mode
- `pnpm dev:server` — Run API server in dev mode
- `pnpm --filter extension build` — Build extension for production
- `pnpm --filter server build` — Build server
- `pnpm lint` — ESLint
- `pnpm format` — Prettier
- `pnpm test` — Vitest

## Notion integration

- Task Board: collection://2928b00e-9d27-47fc-a709-27cfd4b5c9e0
- Devlog: collection://20645fc8-887e-4b9e-a782-a45c888f9624
- Decisions Log: collection://796aacf9-23e4-4038-8bc6-c073afbeadd6
- Use Notion MCP tools to read/update tasks as you work
- Mark tasks Done when acceptance criteria are met
- Log architectural decisions in the Decisions Log

## Workflow

- Pull task from Notion Task Board at start of session
- Build with Claude Code, commit after each logical chunk
- Update task status in Notion when done
- Log devlog entries and decisions as needed
- Use branches only for risky experiments you might revert
