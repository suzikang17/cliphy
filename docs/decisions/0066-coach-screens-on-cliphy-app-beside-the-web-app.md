---
type: decision
title: "Coach on the web: the phone app's web build served on cliphy.app beside the existing web app"
date: 2026-11-17
category: Frontend
revisit: true
---

## Why this choice

Checking a change in the Mac window means rebuilding the Mac app. The owner asked for a web app instead, and one already exists: `apps/web`, the Vite app on cliphy.app with sign-in, the dashboard and summaries. It has none of the coach's screens, and those already exist in `apps/mobile`.

- The Vercel build (`scripts/build-vercel.sh`) now also exports `apps/mobile` for the web and copies it into the same static output. `/chat`, `/projects` and `/coach/*` serve its page (`coach-app.html`); every other address still serves the Vite app.
- **Sign-in is shared, not rebuilt.** Both apps are on one site and both use supabase-js with the default storage key, so a session made at `/login` is the session the coach's screens read. Signed out, they send the visitor to `/login`; an account without the coach is sent to `/dashboard`.
- The Vite nav shows "Coach" for accounts that have it; the coach's side nav has "Library" back to the dashboard.
- `lib/desktop.ts` now separates `DESKTOP` (any web build: side nav, no push or reminders) from `MAC_WINDOW` (the copy built with `EXPO_PUBLIC_TARGET=mac`: no sign-in, the Mac app answers `/api/`).

## Options considered

- **Rewrite the coach's screens in the Vite app.** One web app; every screen written and kept in step twice.
- **Serve the web build under a prefix (`/app`).** Needs `experiments.baseUrl` in `app.json`, which changes the phone's native fingerprint and would cut the installed build off from over-the-air updates. Measured, then reverted.
- **A separate site (app.cliphy.app).** Clean split; needs its own sign-in screen, a CORS entry and a second Vercel project.
- **Same site, the coach's own addresses (chosen).**

## Tradeoffs

- Two single-page apps share one site. Moving between them is a full page load, and their file names must not collide (Vite: `/assets/*`; Expo: `/_expo/*`, `/assets/assets/*`, `/assets/__node_modules/*`).
- The deploy is about a minute longer. If the export fails the site deploys without the coach's pages and the build log says so; the API is never held back by it.
- Both web builds pass `--clear`: the bundler's cache does not notice `EXPO_PUBLIC_TARGET` changing, and served the Mac build the cliphy.app copy until it was cleared.
- The Mac window still carries its own bundled copy. It could load cliphy.app instead once that is proven, at the cost of a sign-in on the Mac.
