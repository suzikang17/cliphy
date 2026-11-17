---
type: decision
title: "Coach over MCP: a stateless endpoint whose tools call the coach's own routes"
date: 2026-11-17
category: AI
revisit: true
---

## Why this choice

The owner wants Claude Code (and later Claude and ChatGPT) to work from Cliphy: see what is open on a client's project, read what was asked, do the work, mark it done so it is ready for a batch. MCP is the standard way for an assistant to reach an outside system, so the server now speaks it at `POST /api/mcp`.

- **Transport:** Streamable HTTP from the official SDK (`@modelcontextprotocol/sdk`, `WebStandardStreamableHTTPServerTransport`), with no session and plain JSON answers. Each request builds its own server, which is what a Vercel function can offer.
- **Tools** (`services/coach/mcp.ts`): `list_projects`, `list_tasks`, `get_task`, `list_requests`, `add_task`, `set_task_state`, `list_batches`, `get_batch`. Each calls the coach's own routes in-process (`coachRoutes.request`) with the caller's key, so validation, reminders and unblocking stay in one place and a tool can do exactly what the key can.
- **Sign-in:** the existing `cliphy_sk_` keys in an `Authorization` header. Setup on the phone has a "Claude Code" row that makes a key and shows the `claude mcp add` line.

## Options considered

- **Tools that query the database directly.** Fewer hops; every rule in the routes (blocked tasks, reminders, ownership) would need a second copy.
- **A local stdio server run by Claude Code.** No hosting question, but something to install and update on each machine, and no path to Claude or ChatGPT on the web.
- **Hand-written JSON-RPC.** No dependency; the SDK tracks the protocol's versions and a real client was easy to test against.
- **A hosted endpoint with thin tools over the API (chosen).**

## Tradeoffs

- The key is unscoped: it can call the whole API, not only these tools. A key limited to `/api/mcp` needs the `scope` column from migration 045, which is not applied yet. Until then the key belongs only on the owner's own machines.
- Claude on the web and ChatGPT connect to remote MCP servers with OAuth, not a pasted header. That is not built; today this works with Claude Code (and any client that can send a header).
- The key is checked once at the door and again on each inner call: a few extra database reads per tool call.
- `get_task` hands the client's own messages and signed picture links to the assistant. That is the point, and it means those words leave Cliphy for whichever model the assistant runs on.
