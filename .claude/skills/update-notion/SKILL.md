---
name: update-notion
description: Use when a task is completed or session work needs logging to Notion. Marks tasks Done on Task Board, appends devlog entries, and logs decisions. Use after completing a feature, fixing a bug, switching tools, or at end of session.
argument-hint: "[task name or 'just devlog']"
---

# Update Notion

Update Notion Task Board, Devlog, and Decisions Log based on recent session work.

## What to do

Look at recent conversation context — commits made, issues hit, tools switched, decisions made — and update the relevant Notion databases.

### 1. Task Board (collection://2928b00e-9d27-47fc-a709-27cfd4b5c9e0)

If a task was completed:

1. Search the Task Board for the task by name
2. Update properties:
   - `Status` → `"Done"`
   - `date:Date Completed:start` → today's date (YYYY-MM-DD)
   - `date:Date Completed:is_datetime` → `0`
   - `Notes` → brief summary of what was done, include commit hash(es)

If the argument is "just devlog", skip this step.

### 2. Devlog (collection://20645fc8-887e-4b9e-a782-a45c888f9624)

Search for today's Day N entry. Append if it exists, create if it doesn't.

Day numbering: Day 0 = Feb 15, Day 1 = Feb 16, etc.

Include:

- **What happened** — concise bullets with commit hashes
- **Why** — root cause or reasoning for non-obvious things
- **What to remember** — gotchas for future sessions

### 3. Decisions Log (collection://796aacf9-23e4-4038-8bc6-c073afbeadd6)

Only if a tech choice was made (tool adopted/rejected, pattern chosen, approach selected).

Include: Decision, Options Considered, Why This Choice, Tradeoffs, Revisit (yes/no).

## Style

- Bullets, not essays
- Include commit hashes
- Be specific about what broke and what fixed it
