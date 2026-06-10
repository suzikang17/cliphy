# Cliphy — Architecture & Ops Notes

Migrated verbatim from Notion 2026-06-07.

## Engineering Doc

> 🔧 Technical architecture, implementation details, and development roadmap.

---

## Tech Stack

- Extension: Chrome Manifest V3, React
- Backend: Node.js + Express (or Hono)
- Database: Supabase (PostgreSQL)
- AI: Anthropic Claude API (Sonnet)
- Payments: Stripe
- Hosting: Vercel or Railway
- Auth: Supabase Auth (Google OAuth)

---

## Tech Stack Details

| Layer       | Technology                    | Rationale                                                     |
| ----------- | ----------------------------- | ------------------------------------------------------------- |
| Extension   | Chrome Manifest V3, React     | MV3 is required for new extensions, React for dashboard UI    |
| Backend API | Node.js + Express (or Hono)   | Fast, familiar, easy to deploy                                |
| Database    | Supabase (PostgreSQL)         | Free tier is generous, built-in auth, real-time subscriptions |
| AI          | Anthropic Claude API (Sonnet) | Best summary quality per dollar                               |
| Payments    | Stripe                        | Industry standard, 2.9% + $0.30, no monthly fees              |
| Hosting     | Vercel or Railway             | Simple deployment, reasonable free/cheap tiers                |
| Auth        | Supabase Auth (Google OAuth)  | Users already have Google accounts for YouTube                |

---

## Sections

The Engineering Doc has the following sub-pages (separate Notion pages, not migrated here):

- System Architecture
- Database Schema
- API Endpoints
- Summary Generation Flow
- Prompt Templates
- Stripe Implementation
- Security & Mitigations
- Environment Variables
- Testing Strategy

## Bizops

The Bizops page contains a single sub-page:

- Workflow Automation

## Workflow Automation

2026-02-17

How Claude Code and Notion work together to minimize manual bookkeeping and keep the project moving.

---

## The Problem

Every task completion followed the same manual cycle:

1. Run lint/build to verify
2. Stage, commit, push
3. Find the Notion task, mark it Done, set Date Completed, add Notes
4. Find the devlog, append an entry
5. Optionally log a decision
   This was done by hand every time, eating 5-10 minutes of overhead per task. Multiply by 3-4 tasks per session and it adds up.

## The Solution: Composable Skills

Two skills that chain together, plus a standalone logging skill.

### `/ship`

The full end-to-end flow. Run this when work is ready to go.

**Steps:**

1. **Verify** — runs the full CI suite locally (prettier, lint, typecheck for all packages, build extension + server, tests)
2. **Commit** — stages files, writes imperative-mood commit message
3. **Push** — pushes to remote, never force-pushes
4. **Update Notion** — invokes `/update-notion` (see below)
   **Why this matters:** We kept pushing code that broke CI because we only ran `pnpm lint` locally. The `/ship` skill now mirrors every CI step so nothing slips through.

### `/update-notion`

The Notion bookkeeping layer. Used by `/ship` or standalone for mid-session updates.

**What it does:**

- **Task Board** — finds the task by name, sets Status to Done, Date Completed to today, adds Notes with commit hashes
- **Devlog** — appends to today's Day N entry (or creates one). Uses standardized sections:
  1. **Session summary** — 2-3 sentence TL;DR at the very top
  2. **What got done** — high-level bullets with commit hashes
  3. **Decisions** — brief notes on tech choices (details in Decisions Log)
  4. **Issues** — what broke, root cause, how it was fixed
  5. **What to remember** — gotchas for future sessions
  6. **Commits** — full list with short descriptions (after a horizontal rule)
  7. **Task details** — per-task breakdowns with `### Task Name` sub-headings (after a horizontal rule)
  8. **Tomorrow's plan** _(optional)_ — what's queued up next
     Omit empty sections. No "What went well" section.

- **Decisions Log** — only when a tech choice was made. Captures decision, options considered, why, tradeoffs, and whether to revisit
  **Standalone use case:** Appending a devlog entry mid-session without committing. Just run `/update-notion just devlog`.

### `/devlog`

The original logging skill. Still works standalone for quick devlog/decisions entries when you don't need to touch the Task Board.

## Composability

```javascript
/ship
  ├─ verify (prettier + lint + typecheck + build + test)
  ├─ commit + push
  └─ /update-notion
       ├─ Task Board (mark Done)
       ├─ Devlog (append entry)
       └─ Decisions Log (if applicable)
```

Each layer is independently useful:

- Just need to log something? `/devlog`
- Task done but not ready to commit? `/update-notion`
- Full ship? `/ship`

## Saved Preferences ([MEMORY.md](http://memory.md/))

These carry across sessions automatically:

- Always research industry-standard approach before adopting an npm package
- Smoke-test packages before committing — don't trust download counts
- When a package is broken, switch immediately
- Use `/ship` after completing work
- Use `/update-notion` for mid-session Notion updates

## WXT Dev Gotchas (also in [MEMORY.md](http://memory.md/))

- Use `build --watch` + manually load unpacked — not `wxt dev`
- Cmd+Shift+. in macOS file picker to show `.output`
- `return true` in `runtime.onMessage` keeps the port open — only use when doing async `sendResponse`
- Background script logs appear in service worker DevTools, not the page console
- Fresh Chrome profiles trigger Google CAPTCHAs and YouTube 403s

## Patterns We Identified (Future Automation Candidates)

| Pattern                     | What happens                                      | Automation idea                                       |
| --------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| Research-then-swap          | Pick a package, find it broken, test alternatives | `/evaluate-package` skill that smoke-tests candidates |
| CI config drift             | Version fields missing or mismatched across files | Lint rule or pre-push hook validating CI config       |
| Repeated Notion boilerplate | Same fetch-update-append cycle every time         | Solved by `/update-notion`                            |
| Extension dev friction      | Fresh profiles, wrong DevTools panel, CPU spikes  | Documented in [MEMORY.md](http://memory.md/) for now  |

## Files

- `.claude/skills/ship/SKILL.md`
- `.claude/skills/update-notion/SKILL.md`
- `.claude/skills/devlog/SKILL.md`
- `.claude/projects/-Users-suki-dev-cliphy/memory/MEMORY.md`

## Day 3 Dependency Analysis & Resequencing

## Overview

After completing Day 3 (e2e summary + eval pipeline), we analyzed all 44 tasks on the Task Board to identify dependency gaps, sequencing issues, and parallelization opportunities.

**Date:** 2026-02-18 (Day 3)

**Tasks completed:** 12 of 44

**Tasks remaining:** 32

---

## Key Findings

### 1. Google OAuth must be pulled forward

Currently scheduled for Day 8, but its only blocker (Supabase project) was completed on Day 2. Nearly everything downstream depends on auth:

- Queue system needs auth middleware
- Rate limiting needs user identity
- User plan tracking needs auth
- Stripe integration needs user plan tracking
- Pro tier gating needs Stripe

**Impact:** Building Days 4-7 features without auth means mock data and rewrites later.

### 2. Missing dependencies in Notion

| Task                      | Listed Blocker | Actually Needs                      |
| ------------------------- | -------------- | ----------------------------------- |
| Build queue system        | None           | Google OAuth (auth middleware)      |
| Background service worker | None           | Queue system + Google OAuth         |
| Rate limiting             | None           | Google OAuth (user identity)        |
| Stripe integration        | None           | Deploy backend + User plan tracking |
| CWS listing (Day 11)      | None           | Demo GIF (Day 12) -- backwards      |

### 3. Tasks that could start NOW

- **Google OAuth via Supabase** -- blocker cleared Day 2
- **Deploy backend to production** -- backend skeleton works
- **Set up domain + DNS** -- pure ops
- **Write privacy policy** -- pure content
- **Prompt tuning with real videos** -- eval pipeline done
- **Stress-test transcript fetching** -- transcript service works

### 4. Parallelization tracks

- **Track A (Backend):** Google OAuth -> Queue system -> Rate limiting -> Summary endpoints -> Background worker
- **Track B (Deploy):** Deploy backend -> Domain + DNS -> Stripe webhook URL
- **Track C (Quality):** Prompt tuning + Stress-test transcripts (both independent)
- **Track D (Content):** Write privacy policy -> Landing page copy

Tracks B, C, D can all run in parallel with Track A.

---

## Critical Path

```javascript
Google OAuth -> User plan tracking -> Stripe integration -> Test payment -> Pro tier gating -> Stripe live mode

Queue system -> Background worker -> Popup dashboard -> Queue UI -> Summary detail -> Loading states -> Export

                  Both chains converge at:
Security hardening + Error handling -> E2E testing -> Demo GIF -> CWS listing + Landing page -> Submit -> Launch
```

---

## Resequenced Day Targets

| Day        | Tasks                                                            |
| ---------- | ---------------------------------------------------------------- |
| **Day 4**  | Google OAuth + Deploy backend (both unblocked now)               |
| **Day 5**  | Queue system + Summary endpoints + Rate limiting                 |
| **Day 6**  | Background worker + Popup dashboard + Queue UI                   |
| **Day 7**  | Summary detail + Loading states + Export + Time saved            |
| **Day 8**  | Stripe integration + User plan tracking + Pro gating             |
| **Day 9**  | Security hardening + Error handling + Prompt tuning + Onboarding |
| **Day 10** | Stress-test transcripts + Error tracking + Domain + DNS          |
| **Day 11** | Write privacy policy + Landing page + Record demo GIF            |
| **Day 12** | CWS listing + E2E testing                                        |
| **Day 13** | Submit to CWS + Stripe live mode                                 |
| **Day 14** | Product Hunt + Reddit/IH/Twitter launch                          |

---

## Changes Made

- Updated `Day Target` on all 32 remaining tasks to match resequenced plan
- Added missing `Blocked By` relations where dependencies were identified
- Cleared stale blocker on Google OAuth (Supabase project already Done)

## Start Here (original Notion landing page)

> 👋 Welcome to the Solo SaaS Launch Hub! This template is your command center for building, launching, and growing a solo SaaS product — with AI as your co-pilot at every step.

## Quick Start Checklist

- [ ] Rename project references to your product name
- [ ] Update the Home Dashboard with your tagline and one-liner
- [ ] Use AI to brainstorm and draft your Product Doc sub-pages
- [ ] Use AI to design your tech stack and draft your Engineering Doc
- [ ] Break your MVP into tasks and populate the Task Board (ask AI to help)
- [ ] Log your first Devlog entry (paste your git log into AI for a summary)
- [ ] Use AI to generate brand name ideas and update the Brand Kit
- [ ] Review the Pre-Launch and Post-Launch checklists
- [ ] Draft your launch posts with AI using the Content Calendar

---

## Daily Routine (Claude Code + Notion)

> 🔁 This is your daily dev loop. Notion is your single source of truth — no GitHub Issues, no PRs. Just code and ship.

**Start of session:**

1. Open Claude Code in your project
2. Tell it what you're working on: _"I'm tackling the queue system today"_
3. Claude pulls the task from Notion, reads the acceptance criteria
   **While building:**

4. Write code with Claude, commit to main as you go (`/commit`)
5. Pre-commit hooks auto-run lint + format
   **End of session:**

6. Ask Claude to mark the task Done in Notion
7. Ask Claude to create a Devlog entry summarizing the session
8. Log any architectural decisions in the Decisions Log
   **Weekly:**

9. Fill in the Weekly Review — wins, blockers, next steps
10. Update Finances if you spent anything (API costs, tools, etc.)

---

## How to Use AI in Each Step

> 🤖 This template is designed to be used alongside AI (Claude, ChatGPT, etc.). Each phase has specific ways AI can save you hours.

### 1. Plan It

- _"Here's my product idea: [describe]. Write me a product doc covering problem, solution, target users, MVP features, and pricing."_
- _"Design a technical architecture for [product]. Include tech stack, database schema, API endpoints, and auth flow."_
- _"Brainstorm 20 name ideas for [product description]. Make them short, brandable, and available as .com domains."_

### 2. Build It

- _"Break this feature into subtasks I can complete in 1-2 hours each: [feature description]"_
- _"Here's my git diff from today. Write a devlog entry covering what I built, what went well, and what I got stuck on."_
- _"I need to decide between [option A] and [option B] for [decision]. Analyze the tradeoffs."_

### 3. Launch It

- _"Write a launch tweet thread for [product]. Here's my product doc: [paste]. Keep it punchy and authentic."_
- _"Write a Show HN post for [product]. Focus on the technical build story."_
- _"Write an SEO blog post: 'Best YouTube Summary Extensions in 2026' that positions [product] favorably."_

### 4. Grow It

- _"Here are 10 pieces of user feedback. Group them by theme and prioritize what to fix first: [paste feedback]"_
- _"Here are my metrics for this week. Write a weekly recap and flag anything concerning: [paste metrics]"_
- _"Draft a friendly response to this user bug report: [paste report]"_

---

## How This Template Is Organized

The dashboard follows your project lifecycle:

**0. Start Here** → **1. Plan It** → **2. Build It** → **3. Launch It** → **4. Grow It**

### 1. Plan It — Docs

- Product Doc — Product strategy, pricing, competitive landscape, GTM plan
- Engineering Doc — Technical architecture, database schema, API design, security
- Resources — Documentation links and competitor bookmarks
- Brand Kit — Colors, fonts, tone of voice, asset links

### 2. Build It

- Task Board — Kanban board with your development roadmap
- Build Log — Devlog (daily build journal) and Decisions Log

### 3. Launch It

- Pre-Launch Checklist — Everything before you ship
- Post-Launch Playbook — Launch day and first-week priorities
- Changelog — Track what you ship in each version
- Content Calendar — Plan launch posts, social content, SEO articles

### 4. Grow It

- Metrics — Weekly KPI tracking and monthly recaps
- Weekly Review — Structured reflection template
- User Feedback — Bug reports, feature requests, praise
- Finances — Every dollar in and out
- Ideas & Backlog — Future ideas that shouldn't distract from now

---

## Tips for Solo Devs

- **Use AI everywhere.** Every page in this template can be drafted faster with AI. The prompts above are starting points — adapt them to your product.
- **Don't skip the Devlog.** Even a 3-sentence entry keeps you accountable and gives you content to post.
- **Use the Decisions Log.** Future-you will forget why you chose Stripe over Lemon Squeezy.
- **Weekly Reviews are your GPS.** 15 minutes every Friday saves hours of wandering.
- **Ship the MVP, then iterate.** The Task Board is designed for a 14-day sprint. Don't scope-creep.
- **Build in public.** The Content Calendar and Devlog feed directly into your marketing.

## Services, budget & environment (from providers.md, 2026-06-10)

### Budget

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

### Services & Providers reference

A reference of all external services, APIs, and third-party integrations used across the Cliphy stack.

#### Core Services

| Service           | Purpose                                                         | Package / Integration   | Status  |
| ----------------- | --------------------------------------------------------------- | ----------------------- | ------- |
| Supabase          | Postgres database, auth (Google OAuth), real-time subscriptions | `@supabase/supabase-js` | Active  |
| Anthropic Claude  | AI summarization (`claude-sonnet-4-6`)                          | `@anthropic-ai/sdk`     | Active  |
| Inngest           | Background job queue for async summarization workflow           | `inngest`               | Active  |
| YouTube InnerTube | Fetch video captions/transcripts (direct HTTP, no SDK)          | Native `fetch`          | Active  |
| Stripe            | Subscription payments, checkout, billing portal                 | `stripe`                | Stubbed |

#### Infrastructure

| Service        | Purpose                                           | Notes                                                                   |
| -------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| Vercel         | Serverless hosting for Hono API                   | Custom Build Output API via esbuild, Node.js 20.x, 60s timeout          |
| WebShare Proxy | Optional HTTP proxy for YouTube rate-limit bypass | Falls back to direct fetch if not configured. Uses `undici` ProxyAgent. |

#### Auth

| Provider                    | Flow                                                           | Where                       |
| --------------------------- | -------------------------------------------------------------- | --------------------------- |
| Google OAuth (via Supabase) | `browser.identity.launchWebAuthFlow` → Supabase OAuth endpoint | Extension background script |

#### Monitoring

| Service | Purpose                                          | Package / Integration                                  | Status  |
| ------- | ------------------------------------------------ | ------------------------------------------------------ | ------- |
| Sentry  | Error tracking, performance monitoring, alerting | `@sentry/node` (server), `@sentry/browser` (extension) | Planned |

#### Environment Variables

##### Server (`apps/server`)

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

##### Extension (`apps/extension`)

- `VITE_SUPABASE_URL` — Supabase project URL (public)
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key (public)
- `VITE_API_URL` — Backend API endpoint (default: `http://localhost:3001`)

> Note: the live source of truth for env vars and the Vercel deploy model is also captured in the agent memory files; this reflects the Notion snapshot as of migration.
