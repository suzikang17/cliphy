---
name: devlog
description: Write a devlog entry and/or decisions log entry to Notion summarizing recent work, issues hit, decisions made, and things learned. Use after completing a task, fixing a bug, switching tools, applying workarounds, or at end of session.
argument-hint: "[optional: specific topic to log]"
---

# Devlog

Write a Notion devlog entry and/or decisions log entry based on what happened recently in this session.

## What to capture

Look at the recent conversation context — commits made, issues hit, tools switched, decisions made — and write entries for the relevant Notion databases.

### Devlog entry (collection://20645fc8-887e-4b9e-a782-a45c888f9624)

Write when anything noteworthy happened:

- Task completed
- Bug hit and fixed
- Tool or dependency switched
- Workaround applied
- Something unexpected learned

Include:

- **What happened** — concise bullets
- **Why** — root cause or reasoning
- **What to remember** — for future sessions

Append to the existing Day N entry if one exists for today, otherwise create a new one.

### Decisions Log entry (collection://796aacf9-23e4-4038-8bc6-c073afbeadd6)

Write when a tech choice was made:

- Tool adopted or rejected
- Architectural pattern chosen
- Approach selected between alternatives

Include: Decision, Options Considered, Why This Choice, Tradeoffs, and whether to Revisit.

## Style

- Keep it concise — bullets, not essays
- Include commit hashes when relevant
- Be specific about what broke and what fixed it
- If a workaround was applied, note when to revisit
