---
title: "Day 68 — dev-dash Browse panel polish + lore AI prompt system"
date: 2026-06-14
day: 68
---

**Built out the Browse type-detail panel in dev-dash and wired AI prompts into lore type schemas so Claude knows how to write each doc type.**

## What got done

- **TypeDetailPanel fixed:** replaced `TableColumnForEach` (requires macOS 14.4, incompatible with swift-tools 5.9) with static `Table` columns — Title, Date, Status, Type/Category, Owner. Removed unused `@State private var columns` and `computeColumns()`.
- **New task creation in dev-dash:** added `+` button next to Daily/Browse picker. Opens a sheet to create a lore task file (`docs/tasks/NNNN-slug.md`) with title, status, owner, type fields. Auto-numbers from existing files, reloads panel on save.
- **Fixed sheet freeze:** `.sheet` modifier was nested inside a `@ViewBuilder` func inside `HSplitView` — moved it to the top-level `HSplitView` in body, which resolved the hang on open.
- **`prompt` field added to lore schema:** `docTypeSchema` in `packages/core/src/types.ts` now accepts an optional `prompt: string`. Wrote prompts for `task`, `decision`, and `devlog` schema YAMLs in cliphy matching the established session format (TL;DR, What got done, Decisions, Issues, What to remember, Commits, Task details, Tomorrow's plan).
- **`lore gen` CLI command:** added to `packages/cli/src/cli/index.ts`. Takes `--title` and optional `--field` flags, reads the type's `prompt` from schema, calls Claude (streaming), writes the doc, reindexes. Requires `ANTHROPIC_API_KEY`.
- **Migrated devlog format from memory to schema:** removed the devlog structure bullet from `MEMORY.md`; added one-line instruction to `CLAUDE.md` pointing at `.lore/types/<type>.schema.yaml`.

## Decisions

- **Static Table columns over `TableColumnForEach`:** dynamic columns would need macOS 14.4 minimum which can't be expressed in swift-tools 5.9. Static columns (Title/Date/Status/Type/Owner) cover the useful cases without the platform bump.
- **Schema is source of truth for AI doc format:** rejected a `lore gen-context` command that would generate a derived markdown file — adds sync burden and drift risk. Direct schema read from CLAUDE.md is simpler with no moving parts.
- **`lore gen` streams to stdout + writes file:** lets you see output as it arrives; stderr carries status messages so stdout stays clean for piping.

## Issues

- **Sheet freeze in HSplitView:** `.sheet` attached to a `HStack` inside a `@ViewBuilder` function inside `HSplitView` caused the app to hang on open. Root cause: SwiftUI sheet lifecycle conflicts with nested ViewBuilder scopes inside split views. Fix: attach `.sheet` directly on the `HSplitView`.
- **`lore gen` smoke test hit credit error:** `ANTHROPIC_API_KEY` env var points to an account with no credits. Command structure is correct — it reached the API — but needs a funded key to fully test.
- **SourceKit false positives in DailyTabView.swift:** persistent "Cannot find type X in scope" errors that don't exist in actual builds. Stale index; ignore.

## What to remember

- SwiftUI `.sheet` should be attached at the highest stable view level — not inside `@ViewBuilder` helper functions, especially inside `HSplitView`.
- Claude sessions are bucketed by `startedAt` (first message timestamp), not by when you view them. A session started yesterday shows under yesterday even if you continue it today.
- `lore gen` uses `node ~/dev/lore/packages/cli/bin/lore.js` until `lore` is symlinked into PATH.
- The `prompt` field in `.lore/types/<type>.schema.yaml` is the single source of truth for how Claude writes that doc type — edit there, nowhere else.

---

## Commits

- `227dc3c` two-level browse navigation: type index → doc list with search _(prior session)_
- dev-dash: TypeDetailPanel static columns, NewLoreTaskSheet, sheet freeze fix _(uncommitted)_
- lore: `prompt` field in docTypeSchema, `lore gen` command, `@anthropic-ai/sdk` _(uncommitted)_
- cliphy docs: prompts in task/decision/devlog schemas, CLAUDE.md lore format instruction _(uncommitted)_
