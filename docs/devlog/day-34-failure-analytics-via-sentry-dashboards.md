---
day: 34
date: 2026-03-21
phase: Post-Launch
mood: 😎 Smooth
hours:
tags: [backend]
published_to: []
public: false
title: "Day 34 — Failure analytics via Sentry dashboards"
---

Evaluated options for failure analytics visibility. Decided Sentry dashboards (free plan) are sufficient — zero new code, custom tags already in place. Promoted `videoId` to a Sentry tag for dashboard grouping.

## What got done

- Evaluated 4 approaches for failure analytics: SQL queries, Sentry dashboards, admin endpoint, scheduled digests
- Chose Sentry dashboards — already have `error_category` tags (`billing`, `rate_limit`, `network`, `parse_failure`, `upstream`, `unknown`, `no_captions`)
- Promoted `videoId` from Sentry `extra` (not queryable) to `tags` (`video_id`) across all 3 capture calls in `summarize-video.ts` (`f10aecb`)
- Updated test assertions to match new tag structure

## Decisions

- **Sentry over custom admin endpoint** — free plan gives 10 custom dashboards + Discover queries with full tag support. No code to build/maintain. Can revisit admin endpoint later if proactive alerting needed ($26/mo Team plan for Slack alerts).

## What to remember

- Sentry free plan: 10 custom dashboards, Discover queries, email-only alerts, no Slack/webhook
- Team plan ($26/mo) adds metric alerts + Slack integration
- Dashboard widgets to set up: errors over time by category, top failing videos by `video_id`, P0 billing alert counter

---

## Commits

- `f10aecb` — promote videoId to Sentry tag for dashboard grouping

## Task details

### Add failure analytics dashboard

- Marked Done — using Sentry dashboards instead of building custom code
- Tags already in place: `component`, `error_category`, `severity`, `video_id`
- Recommended widgets documented for manual setup in Sentry UI
