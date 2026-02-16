# Cliphy

YouTube video summarizer Chrome extension with queue system. Add videos to a queue and get AI-powered summaries using Claude.

## Setup

```bash
# Requires Node.js >= 18
nvm use

# Install dependencies
pnpm install

# Copy env template and fill in values
cp .env.example .env
```

## Development

```bash
# Run extension dev server (Vite + CRXJS hot reload)
pnpm dev:extension

# Run API server (Hono on port 3000)
pnpm dev:server
```

### Loading the extension in Chrome

1. Run `pnpm dev:extension`
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select `apps/extension/dist`

## Scripts

| Command                | Description                          |
| ---------------------- | ------------------------------------ |
| `pnpm dev:extension`   | Extension dev server with hot reload |
| `pnpm dev:server`      | API dev server                       |
| `pnpm build:extension` | Production build of extension        |
| `pnpm build:server`    | Build server                         |
| `pnpm lint`            | Run ESLint                           |
| `pnpm format`          | Run Prettier                         |
| `pnpm test`            | Run Vitest                           |

## Project structure

```
cliphy/
├── apps/
│   ├── extension/    Chrome extension (React + Vite + CRXJS)
│   └── server/       Backend API (Hono + Vercel)
├── packages/
│   └── shared/       Shared types & constants (@cliphy/shared)
├── CLAUDE.md         Project context for Claude Code
└── package.json      Workspace root
```

## Tech stack

- **Extension:** Chrome MV3, React, Vite, CRXJS, TypeScript
- **Backend:** Hono, Supabase (Postgres + Auth), Stripe
- **AI:** Anthropic Claude API
- **Monorepo:** pnpm workspaces
- **Hosting:** Vercel
