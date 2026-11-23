---
lore_type: devlog
created: 2026-11-23
title: "Day 77 — A weekly digest of new videos; the liked-videos pull had died twice without saying so"
date: 2026-11-23
day: 77
phase: Growth
---

**Checked the YouTube auto-pull in production for the first time: it was off, and had stopped exactly 7 days after each Google connect. Fixed the parts that are code. Built a first weekly digest (ADR 0072). Nothing here has been tried on a phone yet.**

## What got done

- **A read-only production check of the auto-pull** (`a1cbbb6`): `apps/server/scripts/check-autopull.ts`, run by the "Check YouTube auto-pull" workflow. Prints counts and ages only.
- **Auto-pull fixes** (`c8ab99b`):
  - A Google connection that Google refuses (`invalid_grant`) is dropped, so the app shows Connect again. Before, the app said "connected" for 71 days while nothing was pulled.
  - A passing failure (Google 5xx) no longer switches the pull off.
  - Connecting again switches liked videos back on. Likes made meanwhile are marked seen, so it resumes with new likes only.
  - On the phone, a first connect asks about liked videos straight away.
  - The Watch Later option is removed from phone and web. The one Watch Later pull in production saw 0 videos in 7 days, as Google's 2016 change said it would (ADR 0041).
- **Weekly digest** (`41f14c3`, ADR 0072): migration 051 (`digest_items`, `user_settings.weekly_digest`), `services/digest.ts`, `functions/digest.ts` (Sunday cron and a per-person build), `/api/digest` routes, a Weekly digest screen on the phone reached from Subscriptions, and a push notification that opens it.

- **Where accounts come from** (`1341568`, `7e92eeb`): a counts-only breakdown script (`scripts/account-breakdown.ts`, the "accounts" job of the check workflow), then migration 052 and `services/clientKind.ts`. The server reads extension, website, Mac or phone off the `Origin` and `User-Agent` headers every installed version already sends, and stores `first_client` and `last_client` on the account with the hourly activity touch (`touch_user`). The admin users list shows Clips, First app, Last app and Last active.
- **What the breakdown showed:** 92 accounts, 87 by Google sign-in, 90 on personal mailboxes; 24 sign-ups on Aug 3 to 5; 87 accounts with no clip at all; two accounts hold 295 of 302 clips. People sign in and stop before a first save. The database cannot say why.

## Issues

- **The liked-videos pull stopped 7 days after connecting, twice.** Liked: made 166 days ago, last checked 159 days ago. Reconnected 78 days ago, token last refreshed 71 days ago. A Google OAuth consent screen left in "Testing" issues refresh tokens that expire after 7 days. That matches both runs to the day. **The fix is in Google Cloud Console, not in code: set the app's publishing status to "In production".** Not yet done; until it is, any connection will die after a week again (it will now say so).
- **Reconnecting did not bring liked videos back.** The pull stayed off after the reconnect 78 days ago. Fixed in `c8ab99b`.
- `DigestItem` already existed in `packages/shared` for the coach. The new types are `VideoDigestItem` and `VideoDigestResponse`; the push type is `video_digest`.

## What to remember

- `first_client` is only set within a day of sign-up, so accounts older than 2026-11-23 stay unknown. A save refused before a row is stored is still invisible; PostHog (or Sentry) is the proposed way to see it, not yet decided.
- The full server suite needs `--maxWorkers=2` on the devbox when the transcription service is running, or unrelated tests fail from lack of memory.

- Channel feeds mark Shorts by their link (`/shorts/`). The digest relies on that to drop them; if YouTube changes it, Shorts will appear in digests.
- Feed titles are now XML-decoded (`Tom &amp; Jerry` → `Tom & Jerry`), which also changes titles queued by channel subscriptions.
- The digest shows the 5 closest uploads with no floor on closeness. Look at stored `score` values after a few real digests before choosing one.
- Task 0112 (verify capture flows in production) is still open: liked videos end to end and the "Cliphy" playlist have still never been seen working in production.
