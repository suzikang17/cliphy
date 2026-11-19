---
type: decision
title: "Claude Code works a batch: per-item notes, its own summary, and a work_batch prompt"
date: 2026-11-19
category: AI
revisit: true
---

## Why this choice

The owner wants to pick a client's texts (Lotus), put them in a batch, and point a Claude Code session at it. Claude should address each request in the repo, then give a summary of the changes that addressed each one, in whatever format she asks for, and say what is still not done. The MCP tools (ADR 0065) could only read a batch, and dropped the client's own words.

- **`get_batch`** takes a batch id or a client's name (their newest batch not yet sent). It returns each item with its id, the client's words and pictures (`theirWords`), how it was dealt with, `notAddressed` (items not ticked done), and `stillOpen` (the client's new or confirmed requests that are in no batch).
- **`check_batch_item`** records done with a note of what changed, or not_done with why. This is the same tick the phone makes.
- **`save_batch_summary`** saves Claude Code's own summary. `PATCH /coach/batches/:id` now accepts a summary while the batch is `checking`, once every item is checked, and makes it `ready`. The rule is the same as for the built-in summary writer.
- **An MCP prompt, `work_batch(batch, format?)`**, appears in Claude Code as `/mcp__cliphy__work_batch`. It walks Claude through the steps: read, change, tick, summarize, list what is left. Sending stays with the owner.

## Options considered

- **Keep the server's summary call** (`POST /:id/summary`, Sonnet with the owner's voice). It knows only labels and task titles, not what changed in the code, and it has one fixed format.
- **Claude Code prints the summary and nothing is saved.** That's simpler, but then the phone and Mac window can't send it or detect it was sent (ADR 0063).
- **A tool that does the whole run server-side.** The work happens in the owner's repo, so it belongs in her Claude Code session.

## Tradeoffs

- Two ways to write a summary now. The phone's "Write summary" still works; whichever saves last wins until the batch is sent.
- `stillOpen` lists requests only; loose texts never made into a request or batch are not surfaced there (`find_requests` covers them).
- A batch is still one client. Finding it by name picks the newest unsent one; give the id when a client has several waiting.
