---
type: decision
title: "Batches: a checklist over requests, hand-added tasks and loose messages, summarized in one model call"
date: 2026-11-17
category: Server
revisit: true
---

## Why this choice

The owner reports finished work to a client in one message she sends herself, and wants each thing checked against what was asked before it is reported. A batch is that unit: items for one client, each ticked or carried over, then a summary.

- **An item points at one of three things:** a request, a task added by hand (no request behind it), or a message that never became a request. Each carries a `label` copied when the batch is made, so the checklist reads the same later even if the source is re-read or edited.
- **"Not done" frees the source.** A carried-over item leaves its request, task or message available for the next batch. Nothing else tracks "already reported".
- **The summary is one plain model call in the route** (`claude-sonnet-5-5`, no tools), not an Inngest job: it is short, the owner is waiting on the screen, and a failure returns 502 with the batch unchanged. It is given the client's own words per item, the tasks done for it, the owner's note, and up to eight of the owner's recent messages to that client to copy how she writes.
- **Sending stays with the owner.** The phone opens Messages with the text, or copies it. A batch is marked sent by her tap, or when the Mac helper uploads an outgoing message to that client that contains the summary (`noteOutgoing` in intake).
- **Messages pulled into a task** are a plain link table (`coach_task_messages`). In a batch they are what the client "sent" for that task.

## Options considered

- **Summary as an Inngest job with a Chat message when ready.** Fits the rest of the coach, but the owner is on the batch screen waiting for an editable draft, and Inngest had just been found unregistered for three days.
- **Batch items as requests only.** Simpler, but the owner adds tasks by hand and clients ask for things in messages the bot reads as chat.
- **A `reported` flag on requests and tasks.** Two places to keep in step with batch items; the items already say it.

## Tradeoffs

- The summary call runs inside a serverless request. A slow model call can time out; the batch is unchanged and "Write summary" can be tapped again.
- Sent detection compares text with spacing and bullets flattened. A summary she rewrites heavily in Messages is not detected; "Sent" on the phone covers it.
- A batch has one client. A project with two clients needs two batches.
- Revisit when clients get a portal: the summary may become a page as well as a text.
