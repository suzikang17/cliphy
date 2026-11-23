---
title: PostHog
category: Analytics
status: Active
plan: "Free"
monthly_cost: 0
date_evaluated: 2026-11-23
---

# PostHog

## Why

Product analytics (ADR 0073): the save funnel including refused saves, where visitors come from, and session recordings on cliphy.app. Events are sent from the server (`apps/server/src/lib/analytics.ts`) and from the website (`apps/web/src/lib/analytics.ts`). US region. The project key is public and lives in `packages/shared/src/constants.ts`.

## Cost notes

$0. Free each month: 1 million events and 5,000 web recordings; beyond that events are dropped, not billed. Cliphy sends a few events per save. Do not redeem the "2x free tier" Scale offer: it becomes a paid plan after 12 months.

**Watch:** nothing to watch at this volume. Data sent: account id, app used, save and summary events; on the site, pages and masked recordings.
