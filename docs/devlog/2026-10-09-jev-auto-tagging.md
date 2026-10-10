---
type: devlog
day: 67
date: 2026-10-09
phase: Growth
title: "Day 67 — Jev auto-tagging on every summary (first AI-in-core slice)"
---

**Every summarized video now gets auto-tagged: TypeSafe's Jev applies existing tags, Claude proposes new ones as accept/dismiss suggestions — shipped to prod across server, extension, web, mobile.**

## What got done

- Researched "Jev": TypeSafe AI's classification model (`systemOne` — yes/no "noul", choice, score; no text generation). SDK `@typesafe-ai/sdk@0.6.0`, smoke-tested before adopting.
- Summary prompt now returns 2–4 `topics`; `parseSummaryResponse` normalizes them (lowercase, dedupe, ≤30 chars, cap 4).
- New `services/tagger.ts` (`tagClip`): one Jev call per clip — a noul per existing tag (apply ≥ 0.7) + a choice per topic over `{existing…, none}` to collapse duplicates. Model pinned `jev-1.13.0`; ≤200 tags per call.
- New `auto-tag` Inngest step after `save-result` → `autoTagClip`: merges applied tags, writes unmatched topics to `clips.suggested_tags`. Best-effort (Sentry + flush, never fails the run).
- Migration `030_clips_suggested_tags.sql` applied to prod via `psql`.
- `PATCH /:id/tags` clears accepted suggestions; new `DELETE /:id/suggested-tags/:tag` dismisses. Auto-tag endpoints use the same tagger and are no longer Pro-only (`PRO_FEATURES.AUTO_TAG` removed). Claude Haiku kept as fallback for pre-topics summaries / no key.
- Clients (3 parallel agents): shared `SuggestedTags` chips in extension (cards, detail, pins TagEditor) + web (Dashboard, SummaryPage); native `SuggestedTags` + long-press quick-picks on mobile. TAG_LIMIT now shows an upgrade prompt everywhere (was a silent rollback on web/extension).
- Privacy policy discloses TypeSafe as a subprocessor; dropped "AI auto-tagging" from the Pro upsell.
- Proof: unit tests (31 new/updated, 480/483 pass — 3 pre-existing failures); live Jev smoke (`scripts/smoke-test-tagger.test.ts`) → applied `cooking:baking`, deduped `bread baking`, suggested `sourdough`/`fermentation` in 206ms; real `autoTagClip` on a test-account clip tagged `cooking`, not `politics`; prod deploy Ready, privacy page live.

## Decisions

- Jev classifies, Claude generates; existing tags auto-apply, new tags are suggestions; available on all plans — see [ADR 0048](../decisions/0048-jev-classifies-tags-claude-generates-them.md).
- `suggestedTags` is optional on `Summary` so clients with cached clips don't break.

## Issues

- **Prod deploys had been failing silently-ish for 33 days' worth of pushes:** `scripts/build-vercel.sh` pinned `"runtime": "nodejs20.x"`, which Vercel discontinued — build succeeds, deploy step errors. Bumped to `nodejs22.x` (`132e37f`).
- `summarize-video.test.ts` happy-path tests were already failing: the Inngest mock lacked `send` since `a655ab2` added `request-embedding`. Fixed; step order now asserted.
- Couldn't run a full local video through Claude: Decodo proxy returns 407 locally, and the local Anthropic key is out of credits (`req_011CfsrDrf69rDMXtoGebk8K`). Test clips' status restored after the failed attempts.
- Pre-existing unit failures, untouched: admin `set-count` tests (route doesn't exist), Voyage embedding mock drift, `sharp` libvips dlopen locally.

## What to remember

- Server dev loads the **repo-root `.env`** (`tsx --env-file=../../.env`); `apps/server/.env.local` has `DATABASE_URL`. `TYPESAFE_API_KEY` is in both + Vercel prod/preview.
- Remote Supabase has **no CLI migration history** — `supabase db push` would replay all 30. Apply single files with `psql "$DATABASE_URL" -f`.
- `vercel env add X preview` non-interactively needs an explicit `""` branch arg.
- Free plan's 3-unique-tag cap: auto-applying existing tags can't breach it; accepting a suggestion can (→ upgrade prompt).
- Thresholds 0.7/0.5 are first guesses — tune once accept/dismiss data exists.

---

## Commits

- `8a0afaf` auto-tag every summary with Jev; suggest new tags for accept/dismiss
- `5ba2c88` show upgrade prompt on tag limit; disclose TypeSafe in privacy policy
- `132e37f` bump Vercel function runtime to nodejs22.x (20.x discontinued)

## Tomorrow's plan

- Check Anthropic billing (local key out of credits — confirm prod key is funded).
- Eyeball suggestion chips in extension/web/mobile on a real new summary.
- Backfill topics/suggestions for existing clips? Route web/tweet `enrich` tagging through the tagger?

---

## Later the same session — iOS YouTube fix + Tabs view

**iOS shares of YouTube videos were never summarized (since Sept 5).** `15cf94c` sent every iOS share to the universal `POST /api/clips`, whose YouTube branch saved a bare link marked `completed`. Fix `a3738a1`: extracted the queue's create+dispatch into `services/enqueue-video.ts`, used by both `/queue` and `/clips`; regression tests fail without the fix. The one affected clip (`GLvFTMtw4Jk`, Oct 6) was converted to `pending` for re-summarize.

**Tabs view (browsing-memory piece 1) shipped** — spec `docs/superpowers/specs/2026-10-09-tabs-view-design.md`, [ADR 0049](../decisions/0049-tabs-view-tags-as-contexts-optional-page-reading.md).

- Server `d93a00c`: `POST /api/tabs/organize` (Jev per tab: tag + "probably done"; Claude Haiku names leftover groups), `GET/PUT /api/tabs/hints`, migration 031 `tag_hints` (applied to prod), privacy disclosure.
- Extension `0342995`, `0c116a1` (v1.1.0): side panel Tabs view, Cmd/Ctrl+Shift+K, optional `scripting` + `<all_urls>` toggle, search/keyboard nav, close/stow/move/hints.
- Proof: live Jev smoke separated two clients on the same Linear/Notion hosts 4/4 and flagged Google results done (307ms); 498/501 server + 130/130 extension tests; prod deploy Ready, privacy page live; required manifest permissions unchanged.
- Tuning lesson: Jev's noul is phrasing-sensitive — "is the user finished with this page" scored search/login ~0.2; "is this a transient page the user no longer needs open" scored 0.77–0.95 vs ~0.18 for live work.
- Not yet done: loading the unpacked build in real Chrome (E2E screenshot) and the Chrome Web Store upload of `extension-1.1.0-chrome.zip`.

---

## 2026-10-10 — Tabs view becomes a browsing memory

Built and shipped across server + extension (commits `12324a4`…`fcd58eb`, all on main):

- **Tabs view features:** open/viewed times per tab; duplicate detection (nested under their page, ×N close dupes) + auto-switch instead of reopening a duplicate (undo); per-tag **keywords** matched locally (spacing-insensitive) + Claude-suggested keywords + one-click "＋ phrase" suggestions from shared tab titles; drag (and ⌥↑/↓) to reorder groups, **merge groups** (drag onto a header / ⋯ / ⇧M, tag aliases, undo); hover-reveal header layout; single-key shortcuts with labels shown while ⌘ is held; rename tabs + quick notes (`r`/`n`).
- **⌘⇧S** save-this-page: `POST /api/clips/quick`, keywords + Jev tags, Claude only when nothing fits, animated on-page tag toast; `activeTab` added (no install warning).
- **Trail** (ADR 0050): opt-in closed-tab capture, migrations 033–034 applied, retention forever by default, daily purge cron.
- **Grouping by how tabs were used** (ADR 0051): local switch/opener log → clusters → evidence for Claude; reasons + rename-on-save; zero groups allowed.
- **iOS:** YouTube shares were saved as bare links since Sept 5 — fixed in `a3738a1` (yesterday's entry).

Issues hit / fixed:

- **Dia hides unopened sidebar tabs from `chrome.tabs.query`** (8 of ~23 visible) — confirmed; nothing to fix (wiki: chrome-extensions-in-arc-and-dia). User didn't want an in-UI note (reverted `1ea4deb`).
- **Every window's front tab said "viewing now"** and clicks didn't reach other Dia windows (Dia ignores `windows.update({focused})`) — `active` now means the panel window's front tab; clicks fall back to moving the tab into this window (`3f89d1a`).
- **Groups stuck faded** after quick drags (deferred fade landed after `dragend`, `527a755`) and **upward drags aborted** (collapsing the list inside `dragstart` — Chromium cancels drags whose source moves then, `54800a5`).
- **Peek clears done flag**: clicking a Probably-done tab removed it before Close all (`4556096`).
- **Trail flush rebuilt items from a fixed field list**, silently dropping name/note — caught by a test (`524ece1`).
- **Claude forced a group** ("Make 1-5 groups") → Drive + Stripe "project:lotus-bech"; replaced by 0-5 groups + reasons + behavioural evidence.
- Jev's "done" noul is phrasing-sensitive; "transient page" wording scores search/login 0.77–0.95 vs live work ~0.18.

What to remember:

- Cost (current prices): video summary ~$0.02–0.03 (Sonnet 4.6), tab grouping ~$0.001–0.002 per refresh (Haiku 4.5); Haiku 5.5 / Sonnet 5.5 are 10× / ~33% cheaper — needs an eval before switching.
- Local Anthropic key has no credits; production key balance unverified.
- Proof gaps: drag/merge/rename UI and Claude reasons verified by tests only, not in a real browser / live Claude.
