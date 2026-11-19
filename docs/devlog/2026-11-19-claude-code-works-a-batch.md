---
lore_type: devlog
created: 2026-11-19
title: "Day 74 — Claude Code works a client's batch and writes the summary"
date: 2026-11-19
day: 74
phase: Growth
---

**A Claude Code session can now be pointed at a client's batch (`/mcp__cliphy__work_batch Lotus bullets`). It addresses each request in the repo, ticks each item with a note of what changed, saves a summary in the format asked, and lists what is still not done. Deployed; not yet run against real data.**

## What got done

- **Batch tools over MCP** (`dd7ae9f`, [ADR 0068](../decisions/0068-claude-code-works-a-batch-and-writes-its-summary.md)).
  - `get_batch` takes a batch id or a client's name (their newest unsent batch). Each item comes with its id, `theirWords` (the client's texts and pictures), state and note, plus `notAddressed` and `stillOpen` (open requests in no batch).
  - New: `check_batch_item` (done / not_done with a note) and `save_batch_summary`.
  - `list_batches` now also takes a client.
  - MCP prompt `work_batch(batch, format?)`.
- **Route:** `PATCH /coach/batches/:id` accepts a summary while the batch is `checking` once every item is checked, and makes it `ready`. Until then it answers 409 "Check every item first".
- **Verified:**
  - Route tests 33/33.
  - MCP unit tests cover the new tools and the prompt.
  - A new end-to-end test drives a real MCP client over HTTP into the real routes (fake DB only): get the batch by the name "lotus" → summary refused early → tick done and not_done → save → the leftover item shows in `notAddressed`.
  - Lint and types clean. The only server failures are 3 that fail without these changes too (libvips missing, smoke tests needing live env).
  - Production deployed `dd7ae9f` (Inngest Sync ran on it).

## Decisions

- Claude Code writes the summary itself rather than the server's Sonnet call. It knows what changed in the code, and it can follow any format. The summary is still saved on the batch, so the phone and Mac window send it and sent-detection works.

## What to remember

- Selecting texts was already there: Texts → client → select → **Batch**, on the phone, web and Mac window.
- `stillOpen` covers requests only; texts that never became a request are not listed there.

---

## Commits

- `dd7ae9f` let Claude Code work a batch and write its summary

## Tomorrow's plan

- Connect Claude Code (Mac window → Settings → Claude Code), make a Lotus batch from her texts, run `/mcp__cliphy__work_batch Lotus` in the Lotus repo.
