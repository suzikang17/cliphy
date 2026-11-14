---
date: 2026-11-14
title: Creative coach, build 1 — capture, requests, tasks and the chat bot
---

# Creative coach, build 1 — capture, requests, tasks and the chat bot

## Intent

Cliphy grows from a clip library into a companion for a creative person: a bot
that catches everything coming in, keeps the thread of the work, and reminds
them at the right time. The saved clips stay as the idea library the bot can
draw on.

The first user is Suzi, who runs a small service business making website
changes for independent creatives. The running example is one client, Maren (an
interior designer), who texts small requests: two screenshots, a loose sentence
("I like the writing on page 1 more than page 2") and
replacement copy pasted in. The client, project and copy in this example are
made up; the shape of the request is real.

**Why:** small requests live in message threads and in Suzi's head. Some get
missed, there is no record of what replaced what, and nothing reminds her at a
moment when she can act. Suzi's words: "a super solid system for creatives is
the main itch."

## The four builds

This is four builds that stack. This document covers build 1 only.

1. **Capture and the thread of work** (this document, in two halves: 1a, 1b).
2. **The AI doing the work.** For website changes: approve the plan, the AI
   makes the change, QA checks it against the request, approve the result with
   a before/after.
3. **The client's window.** A client sees their requests, status and history.
   A separate web page under its own name, not inside Cliphy.
4. **Deeper memory and clips.** The bot knows each client's taste and past
   decisions and pulls ideas from saved clips into the work.

Build 1 must not block 2–4. In particular: every `do` task carries a kit
(materials, target, what done means) because build 2's AI needs exactly that,
and requests keep their full source material because build 3 shows it.

## Goals

- Every request from a chosen client lands in one place, with its attachments,
  without Suzi doing anything.
- Each request is turned into a clear statement of what was asked, linked to a
  project, with history kept when one request replaces another.
- A request becomes a short chain of tasks of four kinds: do, tell, ask, get.
- Dated tasks are reminded reliably. This is the bar for success.
- One chat thread with the bot is the way in. The app stays simple.
- Suzi can see everything on her plate and what is coming, without being
  overwhelmed.
- The bot learns from her answers so it asks less over time.
- Setup is solid: each step is proven to work before the next.

## Non-goals (build 1)

- The AI doing website work, QA, approvals of runs (build 2).
- Anything client-facing (build 3).
- A memory graph or clip recommendations (build 4). Build 1 stores learned
  rules as a plain list only.
- Real SMS, email ingestion, or other inbound channels beyond the Mac helper
  and the share sheet.
- Location-based reminders.
- Web app and extension surfaces. Build 1 is the phone app and the server.
- Boards, custom fields, or any setup a project management tool would ask for.
- Billing or plan gating for the new features.
- Packaging the Mac helper for other people.

## Anti-goals

These make it a failure even if it works as drawn:

- **A dated task whose reminder never reached Suzi.** (Her stated failure
  condition.)
- Nagging: per-item nudges for undated things, or check-ins she starts
  ignoring.
- "AI slop" copy: long labels, long button text, bot messages that pad.
- Clunky visuals: a box around everything, heavy shadows on every control.
- The bot silently guessing wrong and filing or interpreting without a trace.
- Cliphy feeling like two apps bolted together.

## What Suzi decided

- Order of builds as above; build 1 first.
- She is the first user; each side (her, a client) eventually has their own
  system.
- The bot reaches her on her phone, like a text, with a good screen for acting
  on things.
- Attachments must be captured. Text alone is not enough.
- She has a Mac that is usually on, signed into her Messages. All interaction
  is on the phone.
- Keep it inside Cliphy. Navigation is **Library** and **Chat**. Podcasts and
  Subscriptions do not need their own tabs.
- The tab is called "Chat".
- The page that shows what is coming is not called "Ahead". ("Up next" is a
  placeholder she has not objected to.)
- Reminders: a task with a deadline or urgency, set by the client or by her,
  is reminded as the time approaches. Everything else sits on the back burner.
- She wants to see all tasks, with only the important ones surfaced, plus a
  look-ahead.
- A reminder works when she is in the right context and has everything she
  needs.
- She needs to see everything she is working on to prioritize.
- Tasks are of four kinds: start work, communicate something to a client,
  request something, go and get something (a real-world errand, such as
  supplies from a store).
- Copy is short, but always keeps who asked, what for and by when
  ("Maren asked for the homepage photo swap by today.").
- Working hours: inside them the bot has free rein to check in, ask what she is
  working on, nudge, and encourage progress photos that slot into the right
  project.
- When the bot does not know, it tries hard to infer, uses the existing
  tagging, or asks a follow-up and learns from the answer. A self-teaching
  layer is required.
- Onboarding and setup must be solid.
- How far back the helper reads a thread is chosen for each client.
- Look: light neo-brutalist, slightly less clunky than Cliphy today.

Everything below that is not in this list is the designer's call and is marked
so in "Calls made for Suzi to check".

## How it works

### 1. Capture

Two ways in.

**Mac helper (main, hands-off).** A small background program on Suzi's Mac
reads the Messages history on disk and uploads new messages, with attachments
at full quality, from the threads she picked. It:

- only reads threads for people marked as clients;
- reads one-to-one threads only, blue or green (iMessage or SMS). Group chats
  are out of scope for build 1;
- uploads both directions (hers and the client's), so the bot has the
  conversation and can tell when a reply or a "tell" message was sent;
- keeps a cursor and catches up after being off;
- on first connecting a client's thread, reads back as far as Suzi chooses
  for that client: new messages only, a window (for example the last three
  months), or the whole thread. The choice is made per client and can be
  widened later. Old requests found this way arrive already marked as
  history, without notifications, so there is no pile to confirm;
- reports a heartbeat so the app knows when it last ran.

**Share sheet (everything else).** Sharing to Cliphy from any app. Today the
share target takes one image or one link and saves it straight to the library.
That stays the default and is not classified by the bot. Build 1 adds an
explicit choice in the share flow, "Send to Chat", which puts the shared items
through the same intake as helper messages. The share target is extended to
accept several images plus text in one share, because a request is usually
more than one item.

iPhone Shortcut automations were considered and dropped: nothing confirms they
pass attachments, and they are reported unreliable on recent iOS.

**Intake.** Messages from one person arriving close together are one bundle
(the Alder House example is two images and two texts sent as one thought). The
bundle is held until the sender has been quiet for a short window, then
processed once.

Attachments that belong to a request or a reply (decided after the bundle is
classified) also appear in Library as clips linked to the project, so client
screenshots sit with Suzi's other saved things. They go through the normal
image pipeline. Attachments in ordinary chat stay with the stored message and
do not become clips.

### 2. Requests and history

The bot reads each bundle and decides: a request, a reply to something it is
waiting on, or ordinary chat. Ordinary chat is kept as thread context and
creates nothing and notifies nobody.

A **request** has:

- the source bundle, untouched (text, attachments, who, when, channel);
- "what I understood": one or two plain sentences;
- the project it belongs to;
- at most one open question when something is ambiguous (in the example:
  does "writing" mean the words or the typeface too?);
- an optional link to the request it **replaces**.

Suzi confirms ("Looks right") or corrects ("Fix it", then says what is wrong in
chat). Nothing is treated as understood until she confirms.

**Replacing.** When a new request targets the same thing on the same project,
the bot proposes that it replaces the earlier one. On confirmation the earlier
request is marked replaced and stays visible underneath the new one. Nothing is
deleted. A project's history is the list of its requests and progress entries
in time order, with replaced items shown dimmed under what replaced them.

### 3. Tasks

A confirmed request becomes a short chain of tasks, proposed by the bot and
editable in chat. Alder House:

1. `ask` Maren: words or type?
2. `do` replace the page 2 copy (after 1)
3. `tell` Maren it is live (after 2)

Suzi can also create tasks herself by telling the bot ("remind me to frame the
print"), with no request behind them.

| Kind | What it is | Button | Kit |
| ---- | ---------- | ------ | --- |
| `do` | Work Suzi does | Start, then Done | Materials, where it goes, what done means |
| `tell` | Tell someone something | Send | A drafted message |
| `ask` | Ask someone for something | Send | A drafted message; then waits |
| `get` | A real-world errand | Got it | Optional checklist, optional place (plain text) |

Rules:

- A task has one kind. "And/or" is handled by the chain, not by mixed kinds.
- States: open, waiting, done, dropped. `waiting` means the ball is with
  someone else.
- A task can be blocked until another finishes. When it unblocks, it becomes
  open and the bot says so.
- **Send** opens Messages with the draft filled in, addressed to the person.
  The task is marked sent when the helper sees the outgoing message; until
  then it shows as "Sent?" with an undo. Without the helper, tapping Send marks
  it sent.
- After an `ask` is sent the task waits. When the person replies, intake links
  the reply, the bot shows it and proposes closing the ask. If there is no
  reply after a few days the bot offers a drafted nudge.
- `get` tasks with the same place are shown as one line ("3 things from the art
  store"). Checklist items can be ticked singly.
- The kind is shown as a small icon before the title, never as a word.
- The kind tells the bot where a task can be done: `tell` and `ask` anywhere on
  the phone, `do` at the desk, `get` when out. The bot batches by this
  ("4 quick replies", "3 small Maren things, about 30 minutes") instead of
  nudging item by item.

### 4. Chat

One thread per user. The bot's messages are short and may carry attachments,
up to three quick-reply buttons, and a link to a request or task. Suzi can
tap a button or type freely ("Only the words. Remind me tomorrow morning to do
it."), and the bot acts on it: answering the open question, creating or
changing tasks, setting reminders, filing things, finding clips.

The bot speaks when:

- a request arrives (what it understood, plus its one question if any);
- a reminder is due;
- a blocked task unblocks, or a waited-on reply arrives;
- the weekly review comes round;
- something is wrong with capture or reminders (see Setup);
- (1b) a check-in is due.

A strip at the top of Chat always shows the count for this week and the next
thing due. Tapping it opens Up next.

### 5. Reminders

Reminders are built as the most reliable part of the system, not as a side
effect of chat.

- A task gets a date from a client's message (the bot spots "by Wednesday" and
  confirms it) or from Suzi.
- Each dated task schedules its reminders on the server, and the phone mirrors
  them as local notifications as a backup, so they fire without signal.
  The server stores push tokens today but has never sent a notification, so
  the whole sending path is new.
- Every reminder is also a message in Chat. The chat thread is the record; the
  notification is the delivery.
- A deadline reminder that is not opened or answered comes back, a limited
  number of times, then stays pinned as overdue at the top of Chat and Up next.
- "Delivered" means the app on the phone reported that it received the
  reminder, not merely that the push service accepted it. A reminder with no
  such report is treated as not delivered: it re-fires, and the local copy on
  the phone covers it in the meantime.
- If the server cannot reach the phone (permission off, token dead, no
  reports coming back), Setup shows it and the bot says so the next time the
  app opens. Build 1 has no second channel such as email; no email service
  exists in the project today.
- Undated tasks get no reminders of their own. They are covered by one weekly
  review: "6 things on the back burner." with Review / Skip.
- "Waiting on you" counts as urgent without a date: the bot needs an answer, or
  a client is waiting for a reply.
- Nothing notifies during the night quiet hours. A reminder that would fall
  in them is moved to before they start, so it is early and never missed.
- Every reminder for a dated task is a deadline reminder. In 1b, working hours
  limit check-ins and nudges only; deadline reminders still fire in the
  daytime outside working hours.

### 6. Up next

A page opened from the strip in Chat. It is not a tab. Two ways to look at it:

**By date** (default): Overdue · This week, by day · Later · Waiting on others
· Errands, by place · Back burner, folded into one row with a count.

**By project:** every active project, one line on where it stands, and its
next step. This answers "what am I in the middle of".

The weekly review also asks which projects matter this week, so the by-project
view has a short "this week" group at the top.

### 7. Filing and learning

When something arrives (a message, a shared item, a photo) the bot decides
which client and project it belongs to, using: who sent it, what Suzi last said
she was working on, what is in the image, the existing tags, and what it has
learned.

- Sure: file quietly, with an undo.
- Fairly sure: file and show where, with "Change".
- Unsure: ask once.

**Learning.** Whenever Suzi answers a bot question or corrects a filing, the
bot may keep a rule: a plain sentence ("Photos of frames go to Studio prints",
"For Maren, 'writing' means the words", "Morning means 9:00"). Rules are used
the next time before asking. They are listed on a "Learned" page under Setup,
where each can be edited or deleted. There is no hidden learning: if it is not
on that page, the bot has not learned it.

### 8. Setup

Setup runs in Chat, driven by the bot, in four steps. Each ends with a real
test.

1. **Reminders.** Allow notifications, then a test reminder she must tap.
2. **First client.** She types a name.
3. **Messages.** Connect the Mac, or "Later". Pairing is a short code shown on
   the phone and typed on the Mac. The helper walks her to the system setting
   it needs, then confirms it can read the chosen thread by showing the latest
   message from it. She then picks how far back to read for that client. The
   same choice is offered whenever a client is added later.
4. **Try it.** Share or receive one real request and watch it become a
   request.

Steps can be skipped and resumed. A **Setup** page behind the avatar shows each
connection, when it last worked and what is unfinished: Reminders, Mac
messages, Share sheet, Working hours (1b), Clients, Learned. It doubles as the
health check: if the Mac goes quiet or reminders stop getting through, it shows
there and the bot says so in Chat.

### 9. Working hours, check-ins and progress photos (1b)

- Suzi sets working hours once (days, start, end). Asked during setup once 1b
  ships.
- Inside them the bot may check in: at the start ("What are you on today?" with
  a few suggestions from Up next), during ("Still on Alder House?"), and at the
  end ("Photo of where you got to?").
- Her answer sets the **current focus**: a project and optionally a task. The
  focus opens that task's kit and is the strongest clue for filing.
- Check-ins back off when ignored and stop for the day after repeated silence.
- Outside working hours the bot sends no check-ins or nudges. Deadline
  reminders still arrive (see Reminders).
- **Progress photos.** The plus button offers the camera. A photo files to the
  current focus project using the confidence tiers above, and appears in that
  project's history as a progress entry alongside requests.

## Navigation and look

**Navigation.** A bottom bar with Library on the left, a round plus in the
middle, Chat on the right. Each tab is an icon above a small label; the active
tab is shown by colour only. Chat shows a count when something waits on her.

- Library holds everything saved. Filters across the top: All, Videos,
  Podcasts, Web, Images. Subscriptions becomes a "Following" row at the top.
- Settings, Setup and Learned sit behind the avatar in the header.
- Request pages, project history and Up next are pages you step into and back
  out of. They have no tab bar entry.

**Look: light neo-brutalist.**

- Outlines are 1.5px black. Hard shadows are 2px and only on bot message
  cards, Library clips and the plus button.
- Lists are flat: plain rows separated by a hairline, no box per row. Dates are
  a number and a day; status is one small coloured word at the right.
- Quick-reply buttons are small rounded outlines. The main action is filled
  purple with a small hard shadow. Purple for filled buttons and active states
  is the darker `neon.700`, for contrast with white text.
- Type is DM Sans, nothing under 11px.

**Copy rules.**

- Always keep who asked, what for and by when. Cut everything else.
- A bot message states the fact and stops; the buttons carry the choices.
- Buttons are one word where possible, two at most.
- A row is a title plus at most one short detail.
- A label never repeats what is already on the row.
- No name tag on bot messages.

**Mockups** are in
[`2026-11-14-creative-coach-mockups/`](2026-11-14-creative-coach-mockups/):
`library-and-chat.html`, `up-next.html`, `setup.html`. `setup.html` is the
reference for line weight and button style; the other two predate the final
lightening and should be read for layout and copy only.

## Shape of the data

A sketch for the builder, not a schema.

- **person**: a client or contact. Name, how to reach them, whether their
  thread is captured.
- **project**: belongs to a person (or to Suzi alone). Name, active or not,
  one-line state.
- **message**: one captured item with its attachments, direction, time,
  channel, and the bundle it was grouped into.
- **request**: source bundle, understood text, project, open question,
  status (new, confirmed, replaced, closed), `replaces`.
- **task**: kind, state, title, kit, `with` person, `after` task, request,
  project, due date and time, place and checklist for `get`.
- **reminder**: task, when, delivery state, acknowledged or not.
- **progress entry** (1b): photo, project, time.
- **learned rule**: the sentence, what it applies to, where it came from.
- **chat message**: who, text, attachments, buttons, links, which button was
  chosen.
- **helper pairing**: the Mac, its token, last heartbeat.
- **settings**: quiet hours, weekly review time, working hours (1b), current
  focus (1b).

**Projects and the existing tags.** Cliphy already has `project:<name>` tags
with hints and keyword rules that file clips before any AI runs. A project is
its own record and is tied to one `project:` tag. Existing `project:` tags seed
project records once, so clips already tagged show up in that project from day
one. Filing something into a project applies its tag, and the tag hints and
keyword rules stay as filing clues. There is one notion of project, not two.

## How it gets made

Build on what Cliphy already uses:

- **Phone:** the existing Expo app. It already has notifications, a share
  target and an image picker.
- **Server:** the existing Hono API on Vercel with Supabase. Push tokens are
  already stored.
- **Scheduled and delayed work:** Inngest, already used for polling and
  summaries. Reminders, bundle windows, re-fires and the weekly review run
  there.
- **Images:** the existing private image bucket, vision and auto-tagging
  services.
- **The bot:** Claude through the existing Anthropic SDK, with tools for the
  actions in "Chat". Use current models; check the options at plan time.
- **Mac helper:** a small script in this repo, run in the background on login.
  It is for Suzi's Mac only in build 1 and does not need to be a packaged app.

The new features sit behind a per-account switch and are on for Suzi only. The
phone app is not in the App Store yet (task 0079 is open), so there are no
public phone users to migrate. Accounts without the switch get the new bar with
Library and the plus only, and no Chat tab. No library-wide clip chat is built.

## Constraints

- Client messages and images are sent to the server and to Claude. Only threads
  Suzi explicitly marks are read. The helper's token can only upload.
- The Mac helper needs a permission that must be granted by hand in Mac system
  settings. Setup has to make that step hard to get wrong.
- Phone notifications are not guaranteed by the platform. The design must
  detect and surface failure, not assume delivery.
- Cliphy is a live product with other users and paid plans. Existing behaviour
  for them must keep working.
- Repo conventions apply: TypeScript strict, Vitest, commit to main, ADRs for
  tooling choices, `docs/providers.md` if a service is added.

## Proof it works

- The Alder House bundle (two screenshots, the "writing on page 1" sentence, the
  replacement copy) is a fixture. Run through intake it yields one request for
  the Alder House project, understood as replacing page 2's text, with the
  words-or-type question, proposed as replacing the 2022 copy. The fixture
  seeds the earlier 2022 request so there is something to replace.
- A dated task produces its reminders at the right times under test with a
  controlled clock, including the re-fire and the overdue state.
- With notifications revoked, Setup and Chat report that reminders are not
  getting through.
- On Suzi's own devices: a text with an image from the chosen thread appears in
  Chat as a request, with the image, with no action from her.
- Two weeks of real use with Maren's thread: every request captured with
  attachments, no dated reminder missed.

## Left to the builder

- The exact reminder schedule per task (how long before, how many re-fires),
  the bundle quiet window, the nudge delay for unanswered asks, check-in
  cadence and back-off numbers. Pick sensible defaults and make them easy to
  change.
- How the helper is written and kept running, and how it converts image
  formats the phone cannot show.
- How the bot's tools, prompts and model choices are arranged, and how learned
  rules are fed in.
- Table design and migrations.
- Whether a fallback channel (such as email) is worth adding for deadline
  reminders when notifications fail, given the services already in
  `docs/providers.md`.
- How 1a and 1b are cut into steps. 1b follows 1a directly.

## Calls made for Suzi to check

These were not decided by Suzi. Each is the designer's call.

1. Everything in a chosen client's thread is pulled in and sorted by the bot;
   ordinary chat is stored but creates nothing. (She was asked "everything or
   only what you send in" and answered about attachments.)
2. The helper also uploads her own outgoing messages in those threads.
3. The bot reaches her by app notification, not real SMS.
4. Shortcut automations are dropped.
5. Build 1 is split into 1a and 1b; working hours, check-ins and progress
   photos are 1b.
6. "Queue" is renamed "Library"; Subscriptions becomes "Following"; Settings
   moves behind the avatar.
7. The new features are switched on for her account only; other accounts get
   Library and the plus with no Chat tab.
8. "Up next" as the page name.
9. Back-burner items get one weekly review, not a nudge each.
10. "Waiting on you" is treated as urgent without a date.
11. No location tracking; errands are grouped by a typed place name.
12. Learned rules are a visible, editable list.
13. Lists are flat and cards are reserved for bot messages and clips.
14. Phone only for build 1; no web or extension surface.
15. The client's window (build 3) is a separate web page, not part of Cliphy.
16. Only one-to-one threads are captured; group chats are left out.
17. Sharing to Cliphy still saves to the library by default; "Send to Chat" is
    a separate choice in the share flow.
18. Only attachments from requests and replies become Library clips.
19. Nothing notifies at night; a reminder due then arrives before quiet hours
    start. Working hours limit check-ins, not deadline reminders.
20. A reminder counts as delivered only when the phone reports receiving it.
    There is no email fallback in build 1.
21. Projects are tied to the existing `project:` tags, which seed them.
22. Old requests read from a thread's past arrive as history, with no
    notifications and nothing to confirm.
