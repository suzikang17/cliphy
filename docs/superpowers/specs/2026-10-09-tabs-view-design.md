---
type: spec
date: 2026-10-09
title: Tabs View — content-aware tab organizer (side panel)
---

# Tabs View — Design Spec

**Date:** 2026-10-09
**Status:** Approved in brainstorm, pending spec review
**Scope:** Piece 1 of 3 of the "browsing memory" initiative

## Context

Goal: open tabs freely without losing them. Tabs should be organized automatically — including
by _content_ (e.g. which client a Notion/Linear page belongs to), not just by site — and be fast
to find and jump to.

The initiative is split into three pieces, each with its own spec → plan → build:

1. **Tabs view** (this spec) — live organizer of open tabs in the side panel.
2. **Trail** — closed tabs saved automatically as lightweight, embedded clips kept _separate_
   from the curated library (hidden unless promoted).
3. **Resurfacing** — "you looked at this before" items related to the current page, plus
   semantic search over the trail (reuses embeddings / `match_clips` / `findRelatedClips`).

Pieces 2 and 3 ship together later; nothing in this spec stores browsing data server-side.

Builds on: side panel (`entrypoints/sidepanel`), Jev tagger (ADR 0048, `services/tagger.ts`),
tag hierarchy (`parent:child`), the optional-permission pattern used for `history`
(`wxt.config.ts`).

## Decisions (from brainstorm)

| Question                  | Decision                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Where it lives            | New **Tabs** view in the side panel + a keyboard shortcut that opens it with search focused                                   |
| Native Chrome tab groups? | No — organization lives in Cliphy's view; the tab strip is untouched                                                          |
| Categories                | **Tags are the contexts.** Client contexts are hierarchical tags (`client:acme`); per-tag free-text hints help classification |
| Grouping                  | Instant site grouping → Jev assigns tabs to existing tags → Claude Haiku clusters leftovers into proposed new tags            |
| Page content              | Read via an **optional** `scripting` + `<all_urls>` permission requested at runtime from a toggle                             |
| Plans                     | Available to all plans; server rate limit ~60 organize calls/hour/user                                                        |

## 1. User experience

**Entry points**

- Side panel view switcher gains **Tabs** (`View = "dashboard" | "detail" | "pins" | "tabs"`).
- New manifest command `open-tabs-view`, suggested key **Cmd+Shift+K** (mac) / **Ctrl+Shift+K**
  (others). The background handler calls `browser.sidePanel.open({ windowId })` (allowed from a
  command — it is a user gesture) and messages the panel to switch to Tabs and focus search.
  Users can remap in `chrome://extensions/shortcuts`.

**Layout (top → bottom)**

1. **Search** — live filter over title + URL (case-insensitive substring). Enter activates the
   top match; ↑/↓ move the selection; Esc clears.
2. **Content toggle** (shown until granted) — "Organize by page content" with a one-line
   explanation that page text is sent to Cliphy for classification.
3. **Groups** — collapsible sections: name (tag path rendered `client › acme`), count, actions
   **Close all** and **Stow all** (existing stow flow), and **⋯** menu → _Edit hints_.
   Proposed groups (from Claude) render with a "Suggested" badge and **＋ Save as tag** / **×**.
   A **Probably done** group (always last, rows dimmed) collects tabs Jev flags as finished
   (search results, login/confirmation pages, articles read to the end) with **Close all**. A tab
   flagged done appears only there, not in its topic group; Move-to or clicking it clears the flag
   for that URL.
4. **Rows** — favicon, title, host. Click → `tabs.update(id, {active:true})` +
   `windows.update(windowId, {focused:true})`. Hover **×** closes the tab. **⋯ → Move to…**
   reassigns. The active tab is highlighted.

**Scope:** all windows; only `http(s)` tabs (no `chrome://`, extension, `file://` pages).

**Liveness:** the view subscribes to `tabs.onCreated/onRemoved/onUpdated(status|url|title)/
onActivated` while mounted. Site grouping re-renders immediately; AI organize is debounced 3s
after activity settles. Group order: groups containing the active tab first, then by most
recently accessed tab (`tab.lastAccessed`). Rows within a group by `lastAccessed` desc.

## 2. Grouping pipeline

### Extension (side panel)

`lib/tabs/` (new, pure where possible):

- `siteGroups(tabs)` — group by host (strip `www.`), label = host. Pure, unit-tested.
- `extractPage()` — the function injected via `scripting.executeScript({ target:{tabId}, func })`.
  Returns `{ title, description, text }`: `meta[name=description]`, and the first 2,000 chars of
  `innerText` from the first of `article`, `main`, `[role=main]`, `body`, whitespace-collapsed.
  Also returns `scrolledToEnd: boolean`. Returns `{ skipped: "sensitive" }` if the page contains
  `input[type=password]`.
- `useTabOrganizer()` — hook orchestrating: query tabs → site groups → (if permission) extract
  changed tabs → POST to server → merge assignments.

**Caching** (`storage.session`, cleared when the browser closes):

- `tabs:extract:<url>` → extracted text (avoid re-reading unchanged pages).
- `tabs:assign:<url>` → `{ tag } | { proposed }` from the server.
- `tabs:done:<url>` → done flag from the server; cleared when the user activates the tab or moves it.
- `tabs:override:<url>` → user's manual Move-to choice (also in `storage.local` so it persists
  across sessions; override always wins over the server assignment).

**What gets sent:** only tabs whose URL has no cached assignment (new or navigated). Batch of
at most **60** tabs per request, most recently accessed first; the rest stay in site groups
until the next pass. Fallbacks to `{ url, title }` only (no `text`) when: permission not
granted, tab is discarded/unloaded (`tab.discarded`), script injection throws (e.g. Chrome Web
Store, PDF viewer), or extractor returned `skipped`.

### Server

`POST /api/tabs/organize` — `routes/tabs.ts`, auth required.

Request: `{ tabs: [{ key: string, url: string, title: string, text?: string }] }`

- Validation: 1–60 tabs; `key` ≤ 64 chars; `url` ≤ 2,048; `title` ≤ 300; `text` truncated to
  2,000 server-side.
- Rate limit: 60 requests / rolling hour / user → 429 `{ code: "RATE_LIMITED" }`.

Response: `{ assignments: { [key]: { tag: string } | { proposed: string } | { none: true } }, done: string[] }`
— `done` lists keys Jev judged finished (see step 2).

`services/tab-organizer.ts` → `organizeTabs({ tabs, existingTags, hints })`:

1. Load the user's tags via `rankTags` (most-used first, cap `MAX_EXISTING_TAGS`) and their hints
   from `tag_hints`.
2. **Jev, one `systemOne` call per tab**, concurrency 10. State `{ title, url, description?,
text? }`. Two questions in the same call:
   - `group`: `choice("Which of the user's tags does this page belong to?", { e0: "<tag path> —
<hints>", …, none: "None of these" })`. Assign when choice ≠ none and confidence ≥ **0.6**
     (`ASSIGN_THRESHOLD`).
   - `done`: `noul("Is the user most likely finished with this page — e.g. search results, a
login/confirmation/checkout-complete page, an error page, or an article already read?")`.
     Flag when P(yes) ≥ **0.7** (`DONE_THRESHOLD`; tuned on live Jev 2026-10-09 — transient pages
     scored 0.77–0.95, live work ~0.18. The question is phrased as "Is this a transient page the user
     no longer needs open…"; the "is the user finished…" phrasing scored search/login pages ~0.2). Asked for every tab; the extractor also reports `scrolledToEnd` (scrollY + innerHeight ≥ 90% of scrollHeight) in
     state as a signal.
     Model pinned `jev-1.13.0` (shared constant with `tagger.ts`).
3. **Claude Haiku, one call for all leftovers** (only if ≥ 2 leftovers): input = leftover tabs'
   title + url + first 300 chars of text; output JSON `{ groups: [{ name, keys[] }] }` with 1–5
   groups, `name` a lowercase tag (may be `parent:child`, e.g. `client:brightline`). Names that
   exactly match an existing tag become `{ tag }`. Tabs Claude doesn't group → `{ none: true }`.
4. If `TYPESAFE_API_KEY` is missing: skip step 2 (all tabs are leftovers). If Claude fails:
   leftovers → `{ none: true }`. Never 5xx because an AI provider failed; 5xx only for our bugs.

**Nothing from the request is persisted.** Page text is processed in memory and discarded; logs
record counts only, never URLs/titles/text.

### Data model

Migration `031_tag_hints.sql`:

```sql
create table tag_hints (
  user_id uuid not null references users(id) on delete cascade,
  tag text not null,
  hints text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, tag)
);
alter table tag_hints enable row level security; -- server uses service role; no client policies
```

Endpoints (in `routes/tabs.ts`):

- `GET /api/tabs/hints` → `{ hints: { [tag]: string } }`
- `PUT /api/tabs/hints/:tag` `{ hints }` (≤ 500 chars) → upsert; empty string deletes.

"＋ Save as tag" on a proposed group: tags exist only as values on clips, so a tag with no clips
would vanish. Saving therefore writes a `tag_hints` row (hints may be empty) and the tag list
used by `organizeTabs` = union of clip tags (ranked) and `tag_hints` tags. This makes
`tag_hints` the registry for "contexts with no clips yet".

## 3. Permissions & manifest

- `optional_permissions`: add `"scripting"` (alongside existing `"history"`).
- `optional_host_permissions`: `["<all_urls>"]`.
- Toggle calls `browser.permissions.request({ permissions: ["scripting"], origins: ["<all_urls>"] })`.
  Revocation is detected via `permissions.contains` on view mount and
  `permissions.onRemoved`.
- `commands`: `open-tabs-view` with `suggested_key`.
- **No change to required `permissions`/`host_permissions`** — auto-updating users must not be
  disabled.

## 4. Errors

| Situation                                            | Behavior                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Server / Jev / Claude failure, network error         | Keep site groups + cached assignments; inline "Couldn't organize — Retry" |
| Permission not granted / revoked                     | Title+URL classification only; toggle visible                             |
| Discarded tab, injection blocked, PDF, password page | That tab sent as title+URL only                                           |
| Signed out                                           | Site groups only; "Sign in to organize by topic"                          |
| 429                                                  | Keep cache; next attempt after the next debounce window, silent           |
| > 60 uncached tabs                                   | Send 60 most recent; rest wait for the next pass                          |

## 5. Privacy

- `privacy.html`: new "Tab organization" section — when enabled, page title, URL and up to 2,000
  characters of page text are sent to Cliphy's server and TypeSafe AI (Jev), and for unmatched
  tabs to Anthropic (Claude), to group tabs; not stored. Update "Last updated".
- Toggle copy states plainly that page content leaves the browser.
- Password-form pages skipped by the extractor. A per-site "never read" list is out of scope
  (BACKLOG).

## 6. Testing

- **Extension unit (vitest):** `siteGroups`; `extractPage` text selection/trimming and password
  skip (jsdom); cache/override precedence in the organizer's merge function; search filtering
  and keyboard selection logic.
- **Server unit:** `organizeTabs` with mocked Jev/Claude (assign + done thresholds, hints in criteria
  descriptions, leftover clustering, exact-name → `{tag}`, no-key and Claude-failure paths);
  route validation, auth, 60-tab cap, rate limit; hints GET/PUT.
- **Live smoke (opt-in):** realistic payload of two clients' Linear/Notion-like pages + a
  Google results page (expect `done`) + a recipe + a news article against real Jev with tags `client:acme` (hints) and
  `client:nourish` (hints) — client tabs land in the right client.
- **E2E proof:** load unpacked build, open ~15 tabs spanning two client contexts + misc, grant
  content permission, screenshot grouped panel; trigger shortcut and screenshot focused search.

## Out of scope (later pieces / BACKLOG)

- Trail (closed-tab capture) and resurfacing — pieces 2 & 3.
- Native Chrome tab groups.
- Learning hints from Move-to corrections.
- Per-site "never read" list; duplicate-tab detection.
- Mobile / web surfaces.
