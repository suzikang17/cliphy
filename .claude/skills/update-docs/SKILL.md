---
name: update-docs
description: Use when a task is completed or session work needs logging to the repo docs/. Moves completed tasks to the archive, appends devlog entries, and adds decision ADRs — all in plain markdown. Use after completing a feature, fixing a bug, switching tools, or at end of session. (Replaces the old Notion-based /update-notion.)
argument-hint: "[task name or 'just devlog']"
---

# Update Docs

Update the repo's `docs/` markdown based on recent session work. **Do not write to Notion** — it's a read-only archive. Start from `docs/INDEX.md`.

## What to do

Look at recent conversation context — commits made, issues hit, tools switched, decisions made — and update the relevant `docs/` files.

### 1. Tasks / backlog

If a task was completed:

1. Open its file in `docs/tasks/`.
2. Set `status: done` + `completed: <today YYYY-MM-DD>`; append/extend a `## Work log` section (summary + commit hashes).
3. Run `lore reindex task` (`node ~/dev/lore/packages/cli/dist/cli/index.js reindex task` from the repo).

If new work was discovered: add a line to `docs/BACKLOG.md` (`- [ ] title — note`), or if it's immediately real work, create a task file (`lore add task --title ... --field status=open --field owner=human`, or promote: `lore promote task <query>`).

If the argument is "just devlog", skip this step.

### 2. Devlog → `docs/devlog/`

Find or create today's entry: `docs/devlog/day-NN-slug.md` (next session day number — see `docs/devlog/INDEX.md`). Append if today's exists, create if not. Use these sections in order, omitting empty ones:

1. **Session summary** — 2-3 sentence TL;DR at the very top
2. **What got done** — high-level bullets with commit hashes
3. **Decisions** — brief notes (details go to an ADR)
4. **Issues** — what broke, root cause, fix
5. **What to remember** — gotchas for future sessions
6. **Commits** — full list with short descriptions (after a `---` rule)
7. **Task details** — per-task `### Task Name` breakdowns when multiple tasks completed (after a `---` rule)
8. **Tomorrow's plan** _(optional)_

Then add a row to `docs/devlog/INDEX.md`.

### 3. Decision ADR → `docs/decisions/`

Only if a tech choice was made (tool adopted/rejected, pattern chosen, approach selected). Add `docs/decisions/NNNN-slug.md` (next number) with frontmatter (`date`, `title`, `category`, `revisit`) and sections: **Why this choice**, **Options considered**, **Tradeoffs**. Add a row to `docs/decisions/INDEX.md`.

### 4. Providers

If a service/provider was added, removed, or changed, update `docs/providers.md`.

## Style

- Bullets, not essays
- Include commit hashes
- Be specific about what broke and what fixed it
