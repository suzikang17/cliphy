---
type: decision
title: "Coach server core: debounced bundles, a hand-validated interpretation, and task chains created on confirm"
date: 2026-11-14
category: Server
revisit: true
---

> Spec: [`2026-11-14-creative-coach-capture-and-chat-design`](../superpowers/specs/2026-11-14-creative-coach-capture-and-chat-design.md). Plan: [`2026-11-14-creative-coach-1a-server-core`](../superpowers/plans/2026-11-14-creative-coach-1a-server-core.md).

## Why this choice

The coach has to turn a burst of captured messages (two screenshots, a loose sentence, pasted copy) into one request the user confirms, then into tasks. Four choices shape the server core:

- **Bundles are debounced in Inngest.** Messages from one person within 3 minutes of each other join one `coach_bundles` row. `coach/bundle.touched` triggers `coach-process-bundle` with `debounce: { key: bundleId, period: "3m" }`, so a bundle is read once, after the sender goes quiet. Inngest was already in the stack for polling and summaries.
- **The interpretation is one tool call, validated by a pure parser.** Claude (`claude-opus-5-5`) is offered a single `record_interpretation` tool with `tool_choice: auto` and a system instruction to always call it. `parseInterpretation` then drops ids that are not in the context, caps question options, repairs `after` references and never throws. A reply with no tool call is an error the job retries.
- **The task chain is stored as proposed JSON until confirm.** `coach_requests.proposed_tasks` holds the chain. `POST /coach/requests/:id/confirm` creates `coach_tasks` rows once, guarded by `.eq("status", "new")`, and drops the `ask` the user already answered.
- **A project is a record tied to one `project:<slug>` tag.** Existing `project:` tags seed `coach_projects`, and filing a request's attachments applies the tag, so there is one notion of project.

## Options considered

- **Forced tool call (`tool_choice: { type: "tool" }`):** the usual way to get structured output, and what the plan first specified. Current models (Opus 5.5, Sonnet 5.5) reject it with a 400.
- **Structured outputs / `strict: true` tools:** the right long-term answer, but the installed `@anthropic-ai/sdk` is 0.39 and predates both. Upgrading across a major version touches the summarizer, chat and vision paths and was out of scope.
- **Create tasks at interpretation time:** simpler reads, but tasks would exist for requests the user never confirmed, and "Fix it" would have to delete them.
- **Bundle in the request handler with a timer or a cron sweep:** no debounce primitive on Vercel functions; a sweep adds latency and a second code path.
- **Projects as tags only:** no place for people, state or history ordering.

## Tradeoffs

- A new request appears about 3 minutes after the last message. "Fix it" bypasses the wait through a second function, `coach-reprocess-bundle`.
- Schema guarantees come from our parser, not the API. Revisit when the SDK is upgraded (BACKLOG): move to `strict: true` or `output_config.format` and add refusal fallbacks.
- `claude-opus-5-5` costs twice Sonnet 5.5 per token. It is one constant (`INTERPRET_MODEL`) and worth re-checking against the Alder House fixture on Sonnet.
- `blocked` is computed from the predecessor's state on read, so the task list loads all of a user's tasks. Fine at this scale.
- "Today" for resolving deadlines is the server's UTC date until user settings carry a timezone.
