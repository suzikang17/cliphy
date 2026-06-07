---
day: 4
date: 2026-02-19
phase: MVP
mood: 🎉 Milestone
hours:
tags: []
published_to: []
public: false
title: "Day 4 — Deploy backend to Vercel + Google OAuth working"
---

## Session summary

Deployed the Hono backend to Vercel after a long debugging journey (~6 approaches tried). Wrote all Google OAuth code, completed manual setup (Google Cloud Console + Supabase provider), and tested the full flow end-to-end — sign in with Google works, popup shows email + plan. Both Day 4 tasks done.

## What got done

### Server refactoring

- Extracted `apps/server/src/app.ts` — all Hono app setup, middleware, routes
- Created `apps/server/src/env.ts` — shared `AppEnv` type for typed context variables
- Trimmed `apps/server/src/index.ts` to dev-only `serve()` call

### Auth middleware + route

- `apps/server/src/middleware/auth.ts` — JWT verification via `supabase.auth.getUser(token)`, sets userId/userEmail on context
- `apps/server/src/routes/auth.ts` — `GET /me` returns user profile, protected by auth middleware. Removed `/callback` stub.

### Extension OAuth flow

- Rewrote `apps/extension/lib/auth.ts` — Supabase OAuth via `browser.identity.launchWebAuthFlow`, token storage in `browser.storage.local`, refresh token support
- Updated `apps/extension/lib/api.ts` — configurable `VITE_API_URL`, auto token refresh on 401
- Updated popup UI — sign in/out with Google, auth state management
- Added `identity` permission to `wxt.config.ts`
- Added `SignInMessage`, `SignOutMessage` types to shared messages

### Vercel deployment ✓

- `https://cliphy.vercel.app/api/health` returns `{"status":"ok"}`
- Uses esbuild bundling + Build Output API v3 + `getRequestListener`

## Decisions

- **esbuild + Build Output API v3** for Vercel deployment — bundles everything into single CJS file, eliminates pnpm monorepo resolution issues, gives full control over runtime config
- **`getRequestListener`\*\*** from \***\*`@hono/node-server`** over `handle()` from `hono/vercel` — the latter returns Web API format (Request → Response) which causes FUNCTION_INVOCATION_TIMEOUT on Vercel Node.js runtime
- **CJS output format** for Vercel Node.js runtime compatibility

## Issues

### The Vercel deployment saga

Tried ~6 approaches before finding one that works. Core problems:

1. **pnpm strict module isolation** — root-level `api/index.ts` can't resolve packages from `apps/server/node_modules`
1. **Hono Web API vs Node.js callback format** — `handle(app)` from `hono/vercel` returns `Request → Response`, Vercel Node.js runtime expects `(req, res)` callback

**Approaches tried:**

1. **`apps/server`\*\*** as Vercel root dir\*\* — Vercel defaulted to `npm install`, failed in pnpm monorepo. Custom install command with `cd ../..` hung indefinitely.
1. **Repo root + \*\***`api/index.ts`\***\* + "Other" preset** — pnpm couldn't resolve `hono` from root. `--shamefully-hoist` got past that but then hit FUNCTION_INVOCATION_TIMEOUT.
1. **Discovered \*\***`api/`\***\* was in \*\***`.gitignore`\*\* — Vercel CLI respects `.gitignore`, so the function wasn't even being uploaded.
1. **Bare \*\***`(req, res)`\***\* handler test** — worked instantly. Confirmed timeout was a Hono handler format issue, not infra.
1. **Build Output API with edge runtime** — still timed out (same handler format problem).
1. **esbuild bundle + \*\***`getRequestListener`\***\* + Build Output API v3** — worked!

**Final architecture:**

- `apps/server/src/vercel.ts` — uses `getRequestListener(app.fetch)` to convert Hono to callback format
- `scripts/build-vercel.sh` — esbuild bundles to `.vercel/output/functions/api/index.func/index.js`
- `vercel.json` at repo root — `{"buildCommand": "bash scripts/build-vercel.sh"}`
- `.vercel/output/config.json` — routes `/api/*` to the function

### Other issues

- "No Output Directory named public" — framework preset "Other" expects static files
- ESLint `prefer-const` on `let token` in api.ts — quick fix
- TS type cast needed for `browser.runtime.sendMessage` response

## What to remember

- **Hono on Vercel Node.js**: use `getRequestListener` from `@hono/node-server`, NOT `handle()` from `hono/vercel`
- **pnpm monorepo on Vercel**: esbuild bundling is cleanest — avoids all module resolution issues
- **Build Output API v3**: `.vercel/output/` with `.vc-config.json` gives full control
- **Vercel CLI respects \*\***`.gitignore`\*\* — if function dir is gitignored, it won't upload
- `vercel --prod` deploys local files — no git push needed first
- Vercel env vars: set via `vercel env add` or dashboard

---

## Task details

### Deploy Backend to Vercel

- Refactored server entry points (app.ts, env.ts, index.ts)
- Created `vercel.ts` with `getRequestListener` adapter
- Created `build-vercel.sh` for esbuild bundling
- Configured Build Output API v3
- Health endpoint live at `https://cliphy.vercel.app/api/health`

### Google OAuth ✔

- Auth middleware: JWT verification via Supabase
- Auth route: `GET /me` returns user profile
- Extension: full OAuth flow via `browser.identity.launchWebAuthFlow`
- Popup: sign in/out UI
- Manual setup completed: Google Cloud Console OAuth client + Supabase Google provider + extension redirect URL
- **Tested end-to-end**: sign in → Google consent → tokens stored → `/api/auth/me` returns user data → popup shows email + plan

## Commits

- `5f2edc0` — refactor server entry points and deploy backend to Vercel
- `0996a26` — implement Google OAuth flow with Supabase auth
- `7b88dfc` — fix dev:extension script to use wxt dev mode
- `bf064c9` — add .vercel/ to ESLint ignores

## Tomorrow's plan

- Summary storage and retrieval endpoints (`GET /api/summaries`, `GET /api/summaries/:id`, search, delete)
- Basic rate limiting (free tier: 5/day, `GET /api/usage`)
- Connect GitHub repo to Vercel for auto-deploy (2-min manual step)
