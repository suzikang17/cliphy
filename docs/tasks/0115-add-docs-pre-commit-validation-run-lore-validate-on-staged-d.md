---
title: >-
  Add docs pre-commit validation — run lore validate on staged doc types so bad
  frontmatter never lands
status: open
owner: human
ai_run: true
created: "2026-06-10"
---

# Add docs pre-commit validation — run lore validate on staged doc types so bad frontmatter never lands

- [ ] Add docs pre-commit validation — run lore validate on staged doc types so bad frontmatter never lands

## Work log

**Done (2026-06-10, agent):** Added pre-commit doc validation.

- `scripts/validate-docs.sh` — when staged changes touch `docs/**/*.md`, runs `lore validate <type>` for every schema in `docs/.lore/types/`; fails the commit with the offending file/field on any invalid frontmatter. Skips quietly when no docs are staged or the lore CLI isn't built (override path via `LORE_CLI`).
- `.husky/pre-commit` — runs the script after lint-staged.

**Verified:** no-docs-staged → pass; valid docs staged → pass; doc missing required `title` → commit blocked with `9999-invalid-test.md: missing required field "title"`.

**Decisions:** validate-only (no auto-reindex in the hook — hooks mutating staged files mid-commit is a footgun; revisit if INDEX drift becomes annoying). Validates all types rather than only staged ones — full pass is fast and catches cross-type issues.

**For review:** the lore CLI path defaults to `~/dev/lore/...` (machine-specific, consistent with CLAUDE.md); commit-blocking UX.
