# History choice on the Mac, and reopening a history request — design

Date: 2026-11-14
Status: approved by Suzi, 2026-11-14
Builds on: [creative coach, capture and chat](2026-11-14-creative-coach-capture-and-chat-design.md)

## Intent

Suzi connected Messages after work had already been asked for in threads she
had not switched on. She needs to read those threads back and act on what is
still outstanding. Today the Mac app always starts a person at "new messages
only", and anything read from the past is filed as closed history with no
tasks and no way to say "this still needs doing".

## Goals

- When adding someone from Messages in the Mac app, choose how far back to
  read: new messages only (default), the last 30 days, or everything.
- Any history request can be reopened: the coach reads it again as if it had
  just arrived (full model, images included), proposes tasks, and posts it in
  Chat to confirm as usual.

## Non-goals

- Reopening in bulk. One request at a time keeps the pile under control.
- Changing how history is filed on arrival. It still arrives closed and
  silent.
- A history choice on the Mac app's capture switch for people who already
  exist. The phone's Setup already offers it.

## Anti-goals

- Reopening must not create a second request or lose the original messages.
- Reading history must stay silent: only an explicit reopen produces a Chat
  message.

## Approaches

**A. Reopen in place (chosen).** The same request row goes from closed
history to a new request: reinterpret its bundle the way a live bundle is
interpreted, store the proposed tasks and question, clear the history flag,
announce it in Chat. One request, one history line, the existing confirm flow.

**B. Copy into a new request.** Leaves the history row untouched but gives
two rows for one ask, and the project trail shows it twice.

**C. Create tasks directly from the history request, without Chat.** Fewer
steps, but skips the confirm step that every other request goes through and
needs its own screen for editing the proposed tasks.

A was chosen: it reuses the confirm flow and keeps one row per ask.

## Design

- **Mac app:** the Add form under "From Messages" gains a three-way choice
  beside the name. It is sent with the new person as the history setting the
  server and helper already understand (`new`, `window` with 30 days, `all`).
- **Server:** a reopen action on a request, for the signed-in owner. Allowed
  only on a request that is history and closed; anything else is refused
  without change. It runs the live interpretation for that request's bundle
  and updates the same row, then posts the usual "request arrived" message.
  Calling it twice does not interpret twice or post twice.
- **Phone:** a "Still needs doing" button on a history request's page. After
  it succeeds the page shows the request as new, as any fresh request.

## Constraints

- No database change is expected. If one turns out to be needed, it is
  written and tested but not applied to production without asking.
- The phone part reaches Suzi only with an app update.
- Public repo: fixtures use "Maren" and "Alder House".

## Left to the builder

- Route path, wording, and where the choice sits in the Add form.
- Whether reinterpretation reuses the bundle job or a direct call, as long as
  retries are safe.
- How the button behaves while the reopen is in flight.
