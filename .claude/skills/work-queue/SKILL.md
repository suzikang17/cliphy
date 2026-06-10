---
name: work-queue
description: Use when asked to work the agent queue, pick up queued tasks, or when tasks in docs/tasks/ have status open + owner ai. Lists queued tasks, works them, and hands them back to Review & QA via frontmatter.
argument-hint: "[optional: task number or query to pick a specific task]"
---

# Work Queue

Work tasks queued for the agent: files in `docs/tasks/` with `status: open` and `owner: ai`.

## Protocol

1. **List the queue:** grep `docs/tasks/*.md` for frontmatter `status: open` + `owner: ai`. If an argument was given, pick the matching task; otherwise list the queue and pick the first (or ask if several look high-stakes).
2. **Work the task** as normal session work — read its body/notes and any `spec:`/`plan:` references, implement, verify, commit after each logical chunk (per CLAUDE.md).
3. **Log:** append a `## Work log` section to the task body: what was done, commit hashes, decisions made, anything the reviewer should look at.
4. **Hand back:** set `ai_run: true` and `owner: human` (the task moves to Review & QA on the board). If the work is fully done and verified, you may also be told to set `status: done` + `completed:` — default is to hand back for review, not self-approve.
5. **Reindex + commit:** `node ~/dev/lore/packages/cli/dist/cli/index.js reindex task` from the repo, then commit the task file with the work.
6. **If stuck:** set `status: blocked`, add a `## Blocked on` section describing exactly what's needed, reindex, commit, and report.

Never silently drop a queued task — every pickup ends in Review & QA, Blocked, or an explicit report.
