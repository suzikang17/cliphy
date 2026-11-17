---
lore_type: devlog
created: 2026-11-17
title: "Day 72 — Inngest was never told about the coach jobs; batches and texts on tasks"
date: 2026-11-17
day: 72
phase: Growth
---

**Captured messages had sat unread for two days because Inngest still had the pre-coach job list. Fixed by hand, then by a workflow. Built batches (pick finished work, check each item, AI summary for the client) and pulling texts into a hand-added task.**

## What got done

- **Inngest sync** (`248a6a2`). `.github/workflows/inngest-sync.yml` sends `PUT /api/inngest` after every production deploy.
- **Batches, server** (`a5b033c`). Migration `046_coach_batches.sql` (applied to production): `coach_batches`, `coach_batch_items`, `coach_task_messages`. Routes under `/coach/batches`: list, candidates, create, read, tick an item, write the summary, edit it, mark sent, remove. `noteOutgoing` in intake marks a batch sent when the Mac uploads its summary going out. [ADR 0063](../decisions/0063-batches-as-a-checklist-over-requests-tasks-and-messages.md).
- **Texts on a task, server.** `GET/POST/DELETE /coach/tasks/:id/messages` and `GET /coach/people/:id/messages` to pick from.
- **Phone** (`e516a7f`). Project page: "Add a task" and "Batches". New screens: pick (`coach/batch/new`), check and summary (`coach/batch/[id]`), message picker (`coach/task-messages`). Task page shows the texts pulled into it. Ships by OTA.

## Issues

- **Messages captured, nothing in Chat.** Three messages were stored on Nov 15–16 and their bundle stayed `collecting` with 0 attempts; even the 10-minute sweep had not touched it. Root cause: Inngest only runs the functions it was last told about, and nothing had told it since before the coach jobs were added. `curl -X PUT https://api.cliphy.app/api/inngest` answered `"modified": true`; the sweep read the bundle four minutes later and the request appeared in Chat.
- **A tapped answer said nothing back.** The owner tapped an answer on that request. The request was confirmed and two tasks were made, but no "Saved. 2 tasks added." row exists in `coach_chat_messages`. The tap landed 50 seconds after a deploy. Not diagnosed: server logs are not readable from the devbox (Vercel CLI logged out). In the backlog.
- The earlier devlog line "a text reaching Chat ... reported good" does not match production, which had no chat rows before today.

## What to remember

- `GET /api/inngest` answers 401 to an unsigned caller on SDK v4, so it cannot be used to see what is registered. `PUT` needs no signature and re-registers.
- After adding or renaming any Inngest function, check the sync workflow ran. A job that is not registered fails silently: events are accepted and nothing runs.
- A batch item that is a message picked on its own uses the message text as its label, so the check screen shows only its pictures underneath.
- TDD lapse: hand-added tasks in batches (candidates, create, their messages) were written before their tests; the tests were added after and passed first time.
- Not seen on a device yet: every new phone screen. Not run against the real model: the summary.

## Later: Projects tab

- Added a Projects tab on the phone (`dd6f526`): every project with its client, next step and open task count; add a project by name. Before this, a project could only be reached through Up next → By project, which lists only projects that have tasks, so the new batch and "Add a task" controls were effectively hidden.
- `Page` takes `root` for a tab screen (title, no back arrow). The tab bar is now two equal halves around the plus: Library | + | Projects, Chat.
- Not seen on a device yet. `projectRows` is unit tested (3 tests, written first).

## Later: Chat and Projects in the Mac window

- The Mac window now shows the full app: the phone app built for the web, with a side nav (Chat, Projects, Up next, Messages). ADR 0064.
- `apps/mac-app/src/appServer.ts` serves the build at `app://cliphy/` and passes `/api/` calls on with the Mac's key (9 tests, written first). `fakeApi.ts` + `preview` show the app in a browser on made-up data; the CI smoke run now also takes pictures of Chat and Projects.
- Phone code: `lib/desktop.ts`, `DesktopShell`, Return sends in Chat on the Mac, `Page`'s back arrow goes to Chat when there is no history.
- Checked here in headless Chromium against the preview: Chat, Projects, a project page, Up next, deep link, back, Return-to-send (POST seen). Not yet run inside Electron on a Mac; the CI pictures are the first proof of that.

**Issues**

- No text in the first headless screenshots: this devbox has no system fonts or fontconfig, so every web font failed to load. Fixed for the check with a scratch `FONTCONFIG_FILE`; not an app bug.
- `expo export -p ios` fails here at `hermesc` (x86 binary on an arm64 box) and leaves an empty garbage-named file in `apps/mobile`. `--no-bytecode` bundles fine. Pre-existing, unrelated to the change.
- The Mac would have reported its own timezone on launch and could have moved the phone's reminders; desktop mode now skips it.

**What to remember**

- `runtimeVersion` is `fingerprint`: check `npx @expo/fingerprint fingerprint:generate` before and after touching `apps/mobile/package.json`. Adding `react-dom` / `react-native-web` left it unchanged.
- gstack `/browse` is not installed on the devbox; Playwright's Chromium is, but needs libraries and fonts unpacked into a scratch folder (`apt-get download` + `dpkg-deb -x`, `LD_LIBRARY_PATH`, `FONTCONFIG_FILE`).

## Later: the coach over MCP

- `POST /api/mcp` (ADR 0065): eight tools for an outside assistant, each a thin wrapper over the coach's own routes. Added `GET /api/coach/tasks/:id`. Setup on the phone has a "Claude Code" row that makes a key and shows the command.
- Tests written first: 16 for the tools (in-memory client), 6 for the endpoint, one of them the SDK's real HTTP client driven straight into the app; 2 for the single-task route; 2 for the command line.
- The second Mac CI run (`28174b4`) shows Chat and a project page drawn correctly inside the real app on macOS, on made-up data. Headings are not bold there (they are in Chromium on Linux): to look at.
- Not checked: the endpoint with a real key against production (keys can only be made from the phone), and Claude Code itself connecting.

## Later: the coach on cliphy.app

- The existing web app (`apps/web`) had no coach screens. The Vercel build now also exports `apps/mobile` for the web and serves it at `/chat`, `/projects` and `/coach/*` on the same site, sharing the web app's sign-in (ADR 0066). "Coach" in the site nav, "Library" in the coach's nav.
- Checked locally by assembling the site the way the build script does and driving it in headless Chromium: signed out `/chat` → `/login`; with a session, Chat and a project page load; both links work; no page errors.

**Issues**

- `experiments.baseUrl` in `app.json` changes the native fingerprint (`6e52…` → `f85b…`). Reverted; the coach is served at its own addresses instead of under a prefix.
- After building the cliphy.app copy, the Mac build came out asking for a sign-in: Metro's cache ignores `EXPO_PUBLIC_*` changes. Both builds now pass `--clear`.
- **Correction:** migration 045 is applied in production and has been since it was pushed. The Vercel build runs `migrate:deploy`, which applies every pending file. The resume pointer and the 2026-11-16 devlog said it was not; asking before applying 046 by hand was also unnecessary for the same reason. Pushing a migration file is itself the production change.
- `pkill -f <name>` inside a longer command line matches and kills the shell running it. Use `pgrep` with a bracketed pattern, then `kill`.

## Later: project widgets, a person's thread, reading further back

- **Project page** (`814b071`): rebuilt as a board after the owner called the form-like page "a terrible UX". Four number tiles (to do, waiting on them, ready to report, last heard), then widgets: To do (with add), Batches, the client's latest texts, Site (collapsed until edited), Pictures, Asked. `components/coach/Widget.tsx`. On a narrow web window the nav moves to the bottom.
- **Thread** (`/coach/thread/:personId`, list at `/coach/threads`, "Texts" in the nav): everything one person sent and was sent, oldest first, a page of 100 at a time. Tap to select; "Tick off" marks messages dealt with (`coach_messages.handled_at`, migration 047, pushed with the owner's go-ahead), "Batch" starts a batch from them. Each message shows what became of it: Done, In a batch, Request. `GET /people/:id/messages` now pages (`limit`, `before`, `hasMore`) and carries those marks; `POST /people/:id/messages/handled`.
- **Reading further back:** the owner's one client was on "new only" with 3 messages stored, and Setup offered no way to change that while capture was on. Setup now shows the choice for a captured person, and the Mac helper reads again when the choice changes (`HelperState.history`). Needs the Mac app restarted from current `main`.
- Checked in headless Chromium on made-up data: the board at wide and phone widths, the thread (select two, tick off → POST seen, Open filter). Not seen with real data.

## Later: every save from cliphy.app was refused (403)

- The owner tapped "Everything" in Setup on cliphy.app and got "Couldn't reach the server"; the network tab showed 403.
- **Cause:** `app.ts` refuses any request whose `Origin` is not in `ALLOWED_ORIGINS`, and production's list does not include `https://cliphy.app`. A browser sends `Origin` on every write, even to the page's own site, and on no same-site read. So the coach's screens on cliphy.app could show everything and save nothing. My local check of the site used a stand-in server without this rule, and my production check was signed out, so neither could catch it.
- **Fix:** `lib/origin.ts` `originAllowed`: an Origin whose host is the Host the request came to is the site itself and is let through (7 tests, written first). Other sites are still refused.
- The existing web app's own writes (same site, same rule) were presumably refused too; not investigated.

**What to remember**

- Reads working and writes failing on the same site means an Origin rule, not auth.
- A local stand-in for the API hides every rule the real one has. Check one signed-in write against production, or ask the owner to, before calling a web surface done.

## Later: Mac history choice, Settings, pictures where they were sent

- **Mac app** (`19e2a9a`): each captured person in the People list has a "how far back" choice beside their switch. The owner asked why a setting only the Mac acts on could not be set there.
- **Settings** (`3ec27ef`): Setup is now Settings, in the nav, grouped into widgets (next step, People, Getting requests in, Working hours, Connected tools, Learned). Working hours are a switch, two presets, day chips and half-hour steppers that save by themselves (`components/coach/WorkHours.tsx`); typing "09:00" is gone. Key rows are hidden in the Mac window, which cannot make keys.
- **Pictures in place:** Messages marks where a picture sits inside a text with U+FFFC and the helper was stripping the marks, so every picture landed after the whole text. The helper now keeps each place (`placePictures`, `Attachment.at`), sends it with new messages, and reports places once for messages already stored (`POST /coach/intake/layout`, no re-upload). `messageParts` lays a message out as words and pictures in order; `MessageRow` draws it. Places are only trusted when there is one mark per attachment. Needs the Mac app restarted from current `main`.
- The thread and Settings were seen with the owner's real data on cliphy.app (her screenshots); the picture layout only on made-up data.

**What to remember**

- `pkill -f name` from a longer command line kills the shell running it, and a stale preview server then keeps serving old code on the port. Use a bracketed pattern: `pkill -f "dist/previe[w]"`.

## Later: a task from selected messages; failures say what the system said

- **Task from messages:** the thread's selection bar has "Task". It opens a title box pre-filled from the earliest thing they wrote (`taskTitleFrom`: first real line, greeting skipped, cut at a word), offers the person's projects when there is more than one, makes the task and pulls the selected messages into it, then opens it.
- **Error text:** the owner called "That didn't go through" and its kind AI slop: a failure shows the system's own message, or the one word "Error". `errorText` in `lib/coach.ts`; every coach screen's catch now uses it (about forty strings removed), and the Mac controller does the same. Saved as a standing rule in memory.

## Later: Projects board, merge and archive, dark mode

- **Why three projects:** reading a client's whole thread let the interpreter start a project for each stretch of old texts that fit no existing one (`newProjectName` in `processBundle`). Two of the three hold a few old requests and no tasks. Nothing let the owner tidy that up.
- **Projects board:** the flat list (which she called "not very helpful") is now cards grouped under each client: name, state, to do / waiting on them, the next three tasks with due words, and Open / Merge into… / Archive on each card. Archived projects sit behind a link with Restore. `projectBoard` in `lib/coach.ts`; `projectRows` is no longer used by a screen.
- **Merge:** `POST /coach/projects/:id/merge {into}` moves requests, tasks, batches, progress and rules, adds the project's people to the other, and switches the project off. Nothing is deleted.
- **Dark mode:** the shared dark tokens could not be read in the coach's outlined style. Measured on the old background: accent 2.5:1, outlines 2.1:1, dividers 1.2:1. The coach now has its own dark colours (`DARK` in `components/coach/ui.tsx`): text 16.6, muted 8.9, accent 9.0, outlines 5.7. `ACCENT` as a bare constant is gone from the screens; they use `t.accent` (text, icons) and `t.fill` (filled backgrounds under white).
- Still open: the bot creating projects without asking. The owner has not said whether she wants that changed.
- TDD lapse: `projectBoard` and its tests were written in one step, so the tests were not seen failing first.
