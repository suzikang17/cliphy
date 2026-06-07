# Providers, Services & Costs

Infrastructure map for Cliphy — external services, the rationale for each, and cost. Migrated verbatim from Notion (Provider Tracker + Budget + the Services & Providers reference page) on 2026-06-07.

## Provider Tracker

Decision record for each third-party provider: why it was chosen, plan, and cost.

| Provider         | Category | Status        | Plan                                                   | $/mo   | Decision                                       | Date eval. |
| ---------------- | -------- | ------------- | ------------------------------------------------------ | ------ | ---------------------------------------------- | ---------- |
| Anthropic Claude | AI       | Active        | API pay-per-use (Sonnet)                               | —      | Use claude-sonnet-4-6 for summaries            | —          |
| Supabase         | Database | Active        | Free                                                   | $0     | Use for DB, auth, and realtime                 | —          |
| Vercel           | Hosting  | Active        | Hobby (free)                                           | $0     | Deploy Hono API as serverless                  | —          |
| Inngest          | Jobs     | Active        | Free                                                   | $0     | Use for async summarization pipeline           | —          |
| Stripe           | Payments | Active        | Standard (pay-per-transaction)                         | —      | Use for subscriptions and checkout             | —          |
| Decodo           | Proxy    | Active        | Pay-as-you-go ($4/GB) or 3GB sub ($3.75/GB, $11.25/mo) | $11.25 | Replaced WebShare as primary residential proxy | 2026-02-26 |
| WebShare         | Proxy    | Switched Away | Residential rotating proxies                           | —      | Use for YouTube transcript fetching            | 2026-02-26 |

### Details

**Anthropic Claude** — AI · Active

- Why: Best quality/cost ratio for summarization. Structured output reliable. Sonnet is fast and cheap enough for per-request use.
- Cost: ~$3/1M input tokens, ~$15/1M output tokens

**Supabase** — Database · Active

- Why: Postgres + Auth + Realtime in one. Free tier generous (500MB DB, 50k MAU). Industry standard for indie projects.
- Cost: $0 (free tier)

**Vercel** — Hosting · Active

- Why: Zero-config deployment, good free tier, custom Build Output API works with pnpm monorepo + esbuild bundling.
- Cost: $0 (hobby tier)

**Inngest** — Jobs · Active

- Why: Serverless-native job queue. Works on Vercel without infrastructure. Free tier covers dev + early launch volume. Replaced custom polling approach.
- Cost: $0 (free tier, 5k runs/mo)

**Stripe** — Payments · Active

- Why: Industry standard for SaaS payments. Checkout + billing portal + webhooks out of the box. No real alternative at this scale.
- Cost: 2.9% + 30c per transaction

**Decodo** — Proxy · Active (Date evaluated 2026-02-26)

- Why: Formerly Smartproxy. 115M+ residential IPs, 195+ locations, SOCKS5 support, sub-0.6s response, 99.86% success rate. More expensive than WebShare (~$6/mo) but larger IP pool and better success rates.
- Cost: $4/GB PAYG, $11.25/mo for 3GB sub. 3-day free trial. 14-day money-back guarantee.

**WebShare** — Proxy · Switched Away (Date evaluated 2026-02-26)

- Why: YouTube rate-limits direct server requests. Residential proxies bypass blocks. Falls back to direct fetch if not configured.
- Cost: ~$6/mo for residential pool

## Budget

Estimated/actual costs, migrated verbatim. Negative amounts are expenses.

| Item                                | Type    | Category    | Amount | Recurring? | Date       | Notes                                                                          |
| ----------------------------------- | ------- | ----------- | ------ | ---------- | ---------- | ------------------------------------------------------------------------------ |
| Claude API (dev/testing budget)     | Expense | API Costs   | -$10   | no         | 2026-02-14 | Estimated spend during development and prompt tuning. ~$0.01-0.03 per summary. |
| Chrome Web Store developer fee      | Expense | Infra       | -$5    | no         | 2026-02-14 | One-time fee to publish extensions on Chrome Web Store                         |
| Domain name (cliphy.com)            | Expense | Domain      | -$12   | yes        | 2026-02-14 | Annual renewal. Namecheap or Cloudflare Registrar.                             |
| Supabase (DB + Auth)                | Expense | Infra       | $0     | yes        | 2026-02-14 | Free tier: 500MB DB, 50k monthly active users. $0 until we outgrow it.         |
| Vercel hosting (API + landing page) | Expense | Infra       | $0     | yes        | 2026-02-14 | Free tier: generous for hobby projects. $0 until traffic requires Pro plan.    |
| Stripe payment processing           | Expense | Stripe Fees | $0     | yes        | 2026-02-14 | 2.9% + $0.30 per transaction. $0 until first paying customer.                  |
| Domain (cliphy.com or similar)      | Expense | Domain      | -$12   | no         | 2026-02-14 | _(earlier duplicate entry)_                                                    |
| Chrome Web Store developer fee      | Expense | Infra       | -$5    | no         | 2026-02-14 | _(earlier duplicate entry)_                                                    |

---

## Services & Providers reference

A reference of all external services, APIs, and third-party integrations used across the Cliphy stack.

### Core Services

| Service           | Purpose                                                         | Package / Integration   | Status  |
| ----------------- | --------------------------------------------------------------- | ----------------------- | ------- |
| Supabase          | Postgres database, auth (Google OAuth), real-time subscriptions | `@supabase/supabase-js` | Active  |
| Anthropic Claude  | AI summarization (`claude-sonnet-4-6`)                          | `@anthropic-ai/sdk`     | Active  |
| Inngest           | Background job queue for async summarization workflow           | `inngest`               | Active  |
| YouTube InnerTube | Fetch video captions/transcripts (direct HTTP, no SDK)          | Native `fetch`          | Active  |
| Stripe            | Subscription payments, checkout, billing portal                 | `stripe`                | Stubbed |

### Infrastructure

| Service        | Purpose                                           | Notes                                                                   |
| -------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| Vercel         | Serverless hosting for Hono API                   | Custom Build Output API via esbuild, Node.js 20.x, 60s timeout          |
| WebShare Proxy | Optional HTTP proxy for YouTube rate-limit bypass | Falls back to direct fetch if not configured. Uses `undici` ProxyAgent. |

### Auth

| Provider                    | Flow                                                           | Where                       |
| --------------------------- | -------------------------------------------------------------- | --------------------------- |
| Google OAuth (via Supabase) | `browser.identity.launchWebAuthFlow` → Supabase OAuth endpoint | Extension background script |

### Monitoring

| Service | Purpose                                          | Package / Integration                                  | Status  |
| ------- | ------------------------------------------------ | ------------------------------------------------------ | ------- |
| Sentry  | Error tracking, performance monitoring, alerting | `@sentry/node` (server), `@sentry/browser` (extension) | Planned |

### Environment Variables

#### Server (`apps/server`)

- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key
- `ANTHROPIC_API_KEY` — Claude API key
- `STRIPE_SECRET_KEY` — Stripe secret key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `STRIPE_PRICE_ID_PRO` — Stripe monthly price ID
- `STRIPE_PRICE_ID_PRO_YEARLY` — Stripe yearly price ID
- `API_URL` — Self-reference for billing redirects
- `PROXY_URL` — Optional HTTP proxy URL
- `INNGEST_SERVE_HOST` — Inngest webhook endpoint (default: `https://cliphy.vercel.app`)

#### Extension (`apps/extension`)

- `VITE_SUPABASE_URL` — Supabase project URL (public)
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key (public)
- `VITE_API_URL` — Backend API endpoint (default: `http://localhost:3001`)

> Note: the live source of truth for env vars and the Vercel deploy model is also captured in the agent memory files; this reflects the Notion snapshot as of migration.
