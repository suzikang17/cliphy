---
type: decision
title: "Mac helper: a dependency-light Node program that reads chat.db and uploads with an API key"
date: 2026-11-14
category: Capture
revisit: true
---

> Spec section 1 (Capture). Plan: [`2026-11-14-creative-coach-1a-mac-helper`](../superpowers/plans/2026-11-14-creative-coach-1a-mac-helper.md).

## Why this choice

Client requests arrive in the owner's personal Messages, with screenshots. Apple gives apps no way to read those, but the Mac keeps the full history on disk. `apps/mac-helper` reads it and feeds the coach:

- **Node 22 with built-in `node:sqlite` and `fetch`**, run with `tsx`. No native modules to compile, so it runs from the repo after `pnpm install`.
- **`chat.db` opened read-only**, one-to-one chats only (`chat.style = 45`), reactions excluded, text recovered from `attributedBody` when the `text` column is empty.
- **One sync cycle is a function over injected parts** (reader, API, state, image converter, clock), so retry, catch-up and first-connect behaviour is unit-tested on any machine.
- **A message is its Messages `guid`.** The server ignores guids it has, so the cursor moves only after the server accepts a batch: a failure is re-sent, never skipped or duplicated.
- **It signs in with an existing Cliphy API key**, kept in `~/.cliphy-helper/` with mode `0600`.
- **launchd** keeps it running from login. A heartbeat (`POST /coach/intake/heartbeat`) lets Setup show whether it is alive.

## Options considered

- **iPhone Shortcuts automation:** nothing confirms it passes attachments, and it is reported unreliable on recent iOS. Dropped at design time.
- **A signed, packaged Mac app with a pairing code:** right for other people, far more work, and not needed for one owner's Mac.
- **`better-sqlite3`:** a native build step for something Node now ships.
- **AppleScript / the Messages scripting bridge:** cannot read history or attachments.

## Tradeoffs

- It needs Full Disk Access, granted by hand to the `node` binary. `check` explains this when access is missing.
- It depends on the private schema of `chat.db`, which Apple can change. The reader is tested against a fixture with the columns it uses; a real Mac run is the only full proof.
- Everything is uploaded as channel `imessage`, including green-bubble SMS.
- Only image attachments are uploaded; HEIC is converted with `sips`.
- Up to about 20 seconds pass before a new message is uploaded, and the server then waits for 3 quiet minutes before reading the bundle.
