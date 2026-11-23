---
type: decision
title: "PostHog for product analytics: save events from the server, pages and recordings from the website"
date: 2026-11-23
category: Analytics
revisit: true
---

## Why this choice

A counts-only look at production showed 92 accounts, 87 of them with no clip at all, and almost all of them had reached the server while signed in. People sign in and stop before a first save. The database cannot say why: a save that is refused stores nothing, and nothing recorded where a visitor came from or what they did on the site.

The owner asked for monitoring and whether PostHog would help. It does, for the two things the database lacks: a funnel with the refusals in it, and a view of what a new person did before leaving.

- **Save events are sent from the server** (`lib/analytics.ts`). One step after every request records `clip_saved`, or `save_refused` with the status and the refusal's code, for each kind of save. The summarizer records `summary_completed` and `summary_failed`. Each carries which app the request came from (`services/clientKind.ts`, migration 052). Because it is the server, every installed extension and phone app is covered today, with no release and no ad blocker in the way.
- **The website loads `posthog-js`** for page views, where visitors came from, and session recordings. A signed-in visitor is tied to their account id, so their visit joins the server's events for the same account.
- **A person is an account id, nothing more.** No email, no titles, links or text of anything saved. On the site, typed input is never recorded, and everything inside the signed-in pages is text-masked in recordings and left out of click descriptions (`PRIVATE` in `apps/web/src/lib/analytics.ts`).
- **The site sends through its own address** (`/ingest`, two routes in `scripts/build-vercel.sh`), so ad blockers that drop requests to posthog.com do not hide visitors.
- **The project key is in code** (`packages/shared`): it is a public key that can only send events. Only the production deployment sends (`VERCEL_ENV=production`; the site only on cliphy.app).
- **Installed by hand, not with PostHog's wizard.** The wizard needs an interactive login, sets up one app generically, and would not add the server events.

## Options considered

- **Our own events table and admin charts.** Private and no third party, but funnels, retention and recordings would all have to be built.
- **PostHog in every client first** (website, extension, phone). The extension needs a store review and a changed data disclosure; the phone app an update. The server already sees every save.
- **The paid Scale offer** (12 months). Adds single sign-on, audit logs, support and a managed proxy, none needed here, and it turns into a paid plan when the year ends.
- **Server events plus the website (chosen).**

## Tradeoffs

- **The extension itself reports nothing.** A click that never reaches the server (a broken button, a blocked request) is still invisible. Adding events inside the extension is the next step if the funnel points there; it needs a store release and an updated data disclosure.
- **No consent banner.** The site stores a PostHog id in the browser's local storage. Visitors in the EU are arguably owed a choice first. PostHog's cookieless mode is the likely fix; not done.
- **Events sent after a response can be lost** if the function is frozen first. `waitUntil` is used where Vercel offers it.
- **Account ids go to a US company.** Named in the privacy policy (updated the same day).
- **No "signed up" event from the server.** The first event for an account marks it; the website's first identified visit is the closest to a sign-up.
