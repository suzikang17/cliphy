---
day: 15
date: 2026-03-07
phase: Launch Prep
mood: 😎 Smooth
hours:
tags: [backend, marketing]
published_to: []
public: false
title: "Day 15 — Landing Page & Static Pages Migration"
---

Added a landing page at `/` for Stripe compliance and migrated terms/privacy out of Hono into static HTML files served by Vercel.

## What got done

- Landing page with hero, how it works, pricing (Free vs Pro), refund & cancellation policy, footer (`bc5eb48`)
- Migrated `/terms` and `/privacy` from Hono routes to static HTML files (`bc5eb48`)
- Simplified `vercel.ts` — removed root Hono wrapper, now exports app directly (`bc5eb48`)
- Build script copies static pages to `.vercel/output/static/` with clean URLs (`bc5eb48`)
- Fixed pre-existing lint error in webhook-flow test and stale billing test assertion (`bc5eb48`)

## Decisions

- **Static files over Hono routes for HTML pages** — Hono is an API framework, not a page server. Terms/privacy were already pure HTML with no server logic. Static serving via Vercel is simpler and faster.
- **No separate website app** — instead of a new `apps/web/` workspace, served landing page as a static `index.html` from the existing Vercel deployment. Minimal complexity, one deploy.
- **Clean URL structure** — `static/terms/index.html` serves as `/terms` (Vercel convention), no rewrites needed.

## What to remember

- Chrome Web Store URL placeholder (`href="#"`) in landing page CTA — replace when published
- `UPGRADE_URL` in shared constants still points to `cliphy.app/pricing` — update when domain is set up
- Vercel serves `static/index.html` at `/` automatically — no route config needed

---

## Commits

- `bc5eb48` — add landing page, migrate terms/privacy to static files
