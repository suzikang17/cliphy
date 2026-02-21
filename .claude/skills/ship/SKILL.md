---
name: ship
description: Use when work is ready to verify, commit, push, and log to Notion. Runs lint and build checks, commits changes, pushes to remote, then updates Notion task board and devlog.
argument-hint: "[optional: task name for Notion update]"
---

# Ship

Verify, commit, push, and update Notion in one flow.

## Steps

### 1. Verify

Run the full CI suite locally before committing:

- `pnpm exec prettier --check .`
- `pnpm lint`
- `pnpm --filter shared typecheck`
- `pnpm --filter extension typecheck`
- `pnpm --filter server typecheck`
- `pnpm build:extension`
- `pnpm build:server`
- `pnpm test:unit -- --run`

If any fail, stop and fix before continuing.

### 2. Commit

- `git status` to see what changed
- `git diff` to review changes
- `git log --oneline -5` to match commit message style
- Stage relevant files (prefer specific files over `git add .`)
- Commit with imperative mood message

### 3. Push

- `git push`
- If push fails (e.g. behind remote), stop and ask — do not force push

### 4. Update Notion

Invoke the `update-notion` skill with the task name (if provided as argument).

This handles: marking the task Done, appending to devlog, logging decisions.
