---
name: devlog
description: Write a devlog entry and/or a decision ADR to the repo's docs/ markdown summarizing recent work, issues hit, decisions made, and things learned. Use after completing a task, fixing a bug, switching tools, applying workarounds, or at end of session.
argument-hint: "[optional: specific topic to log]"
---

# Devlog

Write a devlog entry and/or a decision ADR based on what happened recently in this session. Everything goes to plain markdown in `docs/` — **do not write to Notion** (it's a read-only archive).

## What to capture

Look at the recent conversation context — commits made, issues hit, tools switched, decisions made — and write to the relevant `docs/` files.

### Devlog entry → `docs/devlog/`

Write when anything noteworthy happened (task completed, bug fixed, tool/dependency switched, workaround applied, something unexpected learned).

- One file per session, **dated filename**: `docs/devlog/YYYY-MM-DD-slug.md`. Keep the **session number** in frontmatter (`day: N`) and the title (`Day N — …`), where `N` increments the latest entry's number (look at `docs/devlog/INDEX.md`). So: dated filename + sequential session number in title/frontmatter. (Older entries use `day-NN-slug.md` — leave them; only new entries use the dated slug.)
- If today's entry already exists, **append** to it; otherwise create it.
- Frontmatter:
  ```
  ---
  day: <N>
  date: <YYYY-MM-DD>
  phase: <MVP | Growth | ...>
  title: "Day N — <short summary>"
  ---
  ```
- Body sections (omit empty ones): **What got done** (bullets + commit hashes) · **Decisions** (brief; details go to an ADR) · **Issues** (what broke, root cause, fix) · **What to remember** (gotchas).
- After writing, add a row to `docs/devlog/INDEX.md`.

### Decision ADR → `docs/decisions/`

Write when a tech choice was made (tool adopted/rejected, architectural pattern chosen, approach selected between alternatives).

- New file `docs/decisions/NNNN-slug.md` — `NNNN` is the next number after the highest in `docs/decisions/` (zero-padded to 4).
- Frontmatter: `date`, `title`, `category`, `revisit` (true/false). Then sections: **Why this choice**, **Options considered**, **Tradeoffs**.
- Add a row to `docs/decisions/INDEX.md`.

## Style

- Keep it concise — bullets, not essays
- Include commit hashes when relevant
- Be specific about what broke and what fixed it
- If a workaround was applied, note when to revisit
