# Vercel Deployment Setup

## Project Settings (Dashboard → Settings → General)

1. **Root Directory**: leave empty (repo root)
2. **"Include files outside the root directory"**: Enabled
3. **Framework Preset**: Other (not Hono — the Hono preset looks for an entry point at root and fails)
4. **Build Command**: leave as default (None) — Vercel bundles `api/index.ts` with its own toolchain
5. **Output Directory**: leave as default
6. **Install Command**: leave as default — Vercel detects pnpm from `packageManager` field in root `package.json`

## Environment Variables

Set all three environments (Production, Preview, Development):

| Variable                    | Source                              |
| --------------------------- | ----------------------------------- |
| `SUPABASE_URL`              | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API |
| `SUPABASE_ANON_KEY`         | Supabase Dashboard → Settings → API |
| `ANTHROPIC_API_KEY`         | Anthropic Console                   |
| `STRIPE_SECRET_KEY`         | Stripe Dashboard (test key for dev) |

## Deploy

```bash
# Preview deploy (has Vercel auth protection)
vercel

# Production deploy (publicly accessible)
vercel --prod
```

## Verify

```bash
curl https://<your-app>.vercel.app/api/health
# → {"status":"ok"}
```

## How It Works

- `api/index.ts` at repo root is the single serverless function entry point
- It imports the Hono app from `apps/server/src/app.ts` via `hono/vercel` adapter
- `vercel.json` at repo root rewrites all `/api/*` requests to this function
- Vercel resolves TypeScript imports and bundles everything automatically
- No `tsc` build step needed — that's only for local dev (`@hono/node-server`)

## Gotchas

- **Don't set root directory to `apps/server`** — Vercel won't find pnpm or the lockfile
- **Don't use the Hono framework preset** — it expects entry files at root (`app.ts`, `index.ts`, etc.)
- **Don't use `cd ../.. && pnpm install` as install command** — it hangs
- **Preview deploys have auth protection** — use `vercel --prod` for public access, or test with `vercel curl`
