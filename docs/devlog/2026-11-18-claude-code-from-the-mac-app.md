---
lore_type: devlog
created: 2026-11-18
title: "Day 73 — Claude Code connects from the Mac app in one press"
date: 2026-11-18
day: 73
phase: Growth
---

**The Mac window's Settings now connects Claude Code itself: one press, using the Mac's own key, with no key to make and nothing to paste. Built and tested; not yet tried on a real Mac.**

## What got done

- **Checked the MCP endpoint first.** `POST /api/mcp` answers 401 without a key on both `api.cliphy.app` and `cliphy.app`; the 24 MCP tests pass. It was not yet connected in Claude Code, and the Mac window hid the Claude Code card.
- **Connect from the Mac app** (`2d80381`, [ADR 0067](../decisions/0067-mac-app-connects-claude-code-with-its-own-key.md)).
  - `apps/mac-app/src/claudeCode.ts`: status / connect / disconnect. It runs `claude mcp remove` then `claude mcp add --scope user cliphy` in the owner's login shell (`$SHELL -ilc`), with the key passed as an environment variable. It reads `~/.claude.json` only to tell whether the coach is there and whether it holds this Mac's key (`on` / `stale` / `off` / `missing`).
  - `main.ts` + `preload.ts`: `helper.claudeCode` IPC. The key stays in the main process and is taken out of any error message. "Copy command" writes the command to the clipboard from the main process.
  - A marker file (`~/.cliphy-helper/claude-code`) records that the app connected Claude Code. Re-pairing moves Claude Code to the new key, and Disconnect removes it.
  - `apps/mobile/app/coach/setup.tsx`: in the Mac window, Connected tools → Claude Code shows a Connect / Disconnect / Copy command card. Its wording lives in `lib/macClaudeCode.ts`. The website runner row stays hidden there.
- **Verified:**
  - 12 module tests, one of which runs the real script in `/bin/sh` against a fake `claude` and checks the exact arguments it receives.
  - 5 card tests; 147 tests across mobile, mac-app and server MCP pass; lint and both typechecks are clean.
  - Headless screenshots of the Mac window card going off → open → Connect → "Connected on this Mac", via `pnpm preview` with a stubbed `window.helper`.

## Decisions

- **Reuse the Mac's key rather than mint a "Claude Code" key.** Minting one would need a server exception to "API keys cannot manage API keys", and a leaked Mac key could then make keys that outlive re-pairing. Same machine, same person, so a second key adds nothing.
- **Go through `claude mcp add`, never by writing `~/.claude.json`.** Claude Code may be writing that file at the same moment.

## Issues

- **No working browser on this Linux devbox.** Playwright's headless shell was missing `libnspr4`, `libnss3`, X and GBM libraries. Workaround without sudo: `apt-get download` the `.deb`s, `dpkg -x` them into the scratchpad, launch with `LD_LIBRARY_PATH`. The page then drew no text because the box has no fonts; `fonts-dejavu-core` plus a `FONTCONFIG_FILE` fixed it.
- gstack `/browse` and `lore` are not installed on this box, so `lore reindex` / `lore validate` were not run for ADR 0067 or this entry.

## What to remember

- An app opened from Finder gets a bare PATH, so `claude` (and node, for an npm install) is only found through the login shell. If someone's `.zshrc` does something interactive, the connect step stalls until its 60 s timeout.
- Claude Code reads MCP servers at startup: an open session needs a restart after Connect. The card says this.
- **Not yet tried on a Mac:** a real press of Connect, the login-shell lookup of `claude`, and the re-pair hand-over.

---

## Commits

- `2d80381` connect Claude Code from the Mac app in one press

## Tomorrow's plan

- On the Mac: rebuild or run the Mac app, Settings → Claude Code → Connect, restart Claude Code, then ask it what's open on a project.
