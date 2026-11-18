---
type: decision
title: "Claude Code on the Mac: the Mac app runs `claude mcp add` with the Mac's own key"
date: 2026-11-18
category: AI
revisit: true
---

## Why this choice

Connecting Claude Code to the coach (ADR 0065) meant making a key on the phone or website, then copying a long command onto the computer. In the Mac window the card was hidden altogether, because keys can only be made by a signed-in person and the window signs in with the Mac's key (ADR 0064). The owner asked for it to work from the Mac app, and pointed out that the Mac app is already on the computer where Claude Code runs.

So in the Mac window, Settings → Connected tools → Claude Code has one button. The Mac app runs `claude mcp add --scope user cliphy …/api/mcp` itself, with the key it already holds.

- **The key is the Mac's own.** It is already stored on this Mac (`~/.cliphy-helper`), and Claude Code here belongs to the same person on the same machine. A second key would be one more thing to lose or revoke, and would protect nothing.
- **The key never reaches the page.** The window asks over the preload bridge (`helper.claudeCode`: status, connect, disconnect, copyCommand). The main process passes the key to the shell as an environment variable, not in the script text, and takes it out of any error message before replying. "Copy command" (offered when `claude` can't be found) writes to the clipboard from the main process.
- **The change goes through Claude Code's own command, never by editing `~/.claude.json`.** Claude Code may be writing that file at the same moment. The file is only read, to show whether the coach is there and whether it holds this Mac's key.
- **The command runs in the owner's login shell** (`$SHELL -ilc`). An app opened from Finder gets a bare PATH, so `claude`, and the node an npm install needs, would not be found otherwise.
- **The connection follows the Mac's.** A marker file (`claude-code`) records that the app connected Claude Code. Pairing again issues a new key, and Claude Code is moved to it. Disconnect in the Mac app also takes the coach out of Claude Code.

The phone and website keep the make-a-key-and-paste flow; they are not on the computer.

## Options considered

- **Let the Mac's key make a dedicated "Claude Code" key** (a server exception to "API keys cannot manage API keys"). That gives a separately revocable key, but a leaked Mac key could then mint keys that outlive re-pairing.
- **Write `mcpServers.cliphy` into `~/.claude.json` directly.** No dependency on finding `claude`, but it could race Claude Code's own writes and would break if the file's shape changes.
- **Point Claude Code at a local proxy in the Mac app** (no key in Claude Code at all). Any process on the machine could then use the account through it, and Claude Code would stop working whenever the app is not running.
- **Mac app runs `claude mcp add` with its own key (chosen).**

## Tradeoffs

- Claude Code can't be revoked separately from the Mac. Revoking one stops both, and the key's "last used" covers both.
- It depends on `claude` being found from a login shell. When it isn't, the card says so and offers the command on the clipboard.
- `-i` sources `.zshrc`. Anything unusual there (prompts that wait for input, `exec tmux`) could stall the command; it times out after 60 s.
- Claude Code reads its MCP servers when it starts, so an open session needs a restart. The card says this.
