---
date: 2026-11-14
title: Creative coach 1b — working hours, check-ins, focus and progress photos
---

# Creative Coach 1b — Working Hours, Check-ins, Focus and Progress Photos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inside the hours she sets, the bot checks in (what are you on, still on it, a photo at the end), her answer becomes the current focus, and a progress photo files itself into the right project.

**Architecture:** When to check in and where a photo belongs are pure functions (`checkins.ts`, `filing.ts`). A 15-minute Inngest cron applies the first; a `POST /coach/progress` route applies the second. Check-ins are ordinary chat messages keyed per day, so the existing "said once" rule and button actions carry them. Focus is two columns on `coach_settings`.

**Tech Stack:** as plans 1–5.

**Spec:** `docs/superpowers/specs/2026-11-14-creative-coach-capture-and-chat-design.md` (section 9, and section 7 for the filing tiers).

## Global Constraints

- Everything in plans 1–5, including the copy rules.
- Check-ins and nudges happen only inside working hours on working days, and never in quiet hours. Deadline reminders are unaffected.
- Check-ins back off: at most 4 a day, at least 2 hours apart, and none for the rest of the day after 2 in a row go unanswered.
- With no working hours set, there are no check-ins at all.
- Filing follows the three tiers: sure → file quietly (the phone shows where, with an undo); fairly sure → file and say where in chat, with a way to move it; unsure → ask once.
- A progress photo is also a Library clip, tagged with its project.

## Review Focus

1. **Working hours that cross a daylight-saving change, or a user whose timezone is not set:** no check-in at the wrong hour; none at all without a timezone.
2. **Two cron runs in the same window:** one check-in, not two.
3. **Every check-in ignored:** they stop for the day and start again tomorrow.
4. **A photo taken with no focus and several active projects:** it is not guessed into one; the bot asks.
5. **A photo's project is changed after filing:** the Library clip's tag follows.

## Tasks

1. **Schema and types.** `042_coach_working_hours.sql` (`work_days`, `work_start`, `work_end`, `focus_project_id`, `focus_set_at` on `coach_settings`; `coach_progress`). Shared: `WorkHours`, `ChatAction` gains `set_focus` and `file_progress`, `ChatLink` gains `camera`, `ChatKind` gains `checkin` and `progress`.
2. **When to check in (pure).** `services/coach/checkins.ts`: `inWorkingHours`, `nextCheckIn`.
3. **Where a photo goes (pure).** `services/coach/filing.ts`: `fileProgress`.
4. **Words.** `botMessages.ts`: `checkIn`, `progressFiled`, `progressAsk`.
5. **Settings and focus.** `PATCH /coach/settings` accepts working hours; `POST /coach/focus`; `executeAction` and the agent handle `set_focus`.
6. **The check-in job.** `coach-checkins`, every 15 minutes.
7. **Progress.** `POST /coach/progress`, `file_progress` action, progress entries in project history.
8. **Phone.** Working hours in Setup; "Progress photo" from the plus; the camera link from chat; photos in project history.
