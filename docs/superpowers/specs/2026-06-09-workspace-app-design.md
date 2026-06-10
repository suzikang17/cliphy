# Workspace app — design (working name: "Atlas", TBD)

**Date:** 2026-06-09
**Status:** Design — approved for spec review
**Consolidates:** lore (engine), tana-roam (parts donor), dev-dash (UX donor + future native shell)

## Vision

One opinionated, multi-project workspace for software work — a combination of **Linear** (project tracking), **Obsidian** (linked markdown), and **Notion** (structured docs) — but **opinionated via user-definable document types**, with **markdown as the source of truth** so both humans and AI agents can read everything (documents _and_ their schemas).

This is the consolidation of three prior attempts at the same idea: **dev-dash** (native Mac, furthest on UX, but no schema engine → drift), **tana-roam** (web shell, but Convex = wrong substrate), and **lore** (the markdown + schema engine — the foundation the other two lacked). The new app assembles known-good parts onto lore's engine; it is not a re-exploration.

## Principles

1. **Markdown is the source of truth** — documents are markdown files in each project's repo; type definitions are YAML schema files in the repo. No database. Agent-parseable end to end.
2. **Types as schemas-in-repo (the spine)** — a type is `docs/.lore/types/<type>.yaml` (lore's existing schema). User-definable fields. The app gives this a UI; the data stays a file. This is the differentiator vs Obsidian/Notion (freeform) and Tana (proprietary DB).
3. **One UI** — a single web app. dev-dash can host it in a WebView later (native feel) without a second UI to maintain. tana-roam stays as its own thing; we lift its editor + components.
4. **lore-core is the engine** — extracted into a shared package the app imports (parse/validate/index/schema over markdown). Same core the CLI/TUI use.
5. **Multi-project from the start** — the app reads several configured repos' `docs/` dirs and shows them together. That's the soul ("all my projects in one place").

## Architecture

```
@lore/core  (extracted package)         parse · validate · index · schema · read/write md
     ▲
Next.js app (new repo, TypeScript)
  • server actions / route handlers  → use @lore/core + Node fs to read/write each repo's docs/
  • config: list of project repo paths (e.g. ~/dev/cliphy, ~/dev/other)
  • UI: projects → types → records → document; + type editor; + doc editor
  • borrows: tana-roam's Lexical editor + React components; dev-dash's UX patterns
  • runs in a browser today; hostable in dev-dash's WebView later
```

The web app is local-first: it runs on the user's machine, server-side reads the local filesystem (the repos), so the browser sandbox isn't a limitation.

## The type system (first-class)

A **type** is a lore schema (`docs/.lore/types/<type>.yaml`): `name`, `dir`, `id` strategy, `body` mode, `frontmatter` fields, `sections`, `index` columns. The app surfaces it:

- **Create a type** (UI "New Type"): name it, add fields (name + field type), choose id strategy + index columns → **writes the `<type>.yaml` schema file**.
- **Edit a type**: add/rename/remove fields → rewrites the schema. (Migrating existing docs on field changes is a later concern; v1 warns rather than auto-migrates.)
- **Create a document** of a type: a new markdown file with that type's frontmatter; the editor renders inputs from the schema (number input for a `number` field, dropdown for an `enum`, etc.).

**Field types (v1):** string, date, boolean, number, enum (lore's current set).
**Field types (v-next):** `reference` (relation to another doc — powers cross-type linking/backlinks), multi-select.

**Model choice:** one type per document (a file _is_ a decision). Not Tana's multi-supertag-per-block. Cleaner for opinionated doc types; revisit only if multi-tagging is genuinely wanted.

## MVP — sequenced slices

**Slice 0 — extract `@lore/core`.** Move `~/dev/lore/src/core` into a standalone package the app (and the existing CLI/TUI) import. Pure functions already; mostly packaging. Justified now (second consumer exists).

**Slice 1 — read-first multi-project browse.** Scaffold the Next.js app; a config of repo paths; sidebar = projects → each project's types → a type's index (the lore-generated table) → click a record → render its markdown. Read-only. This alone is daily-useful (all projects' decisions/devlog in one window) and proves multi-project + markdown-source-of-truth.

**Slice 2 — type creation/editing UI.** "New Type" / "Add Field" / field-type picker → writes/edits `<type>.yaml`. The spine, made visible.

**Slice 3 — document creation/editing.** Create a doc of a type (schema-driven field inputs) + edit its body with a markdown editor (port tana-roam's Lexical setup). Writes the markdown file; `@lore/core` keeps the index correct.

Later (not MVP): `reference` field type + backlinks, search across projects, dev-dash WebView host, the Linear-style roadmap/task views, multi-tag model if wanted.

## What's borrowed (parts donors)

- **tana-roam:** Lexical editor integration, React component patterns, Next.js + Tailwind setup. (Not its Convex data layer — dropped.)
- **dev-dash:** UX patterns — ⌘K command bar, sidebar/linked-docs layout, backlinks panel, ideas board — as design reference; later, its `ProductWebView` shell can host this app.
- **lore:** the entire engine (`@lore/core`) + the existing schemas (decision/devlog/provider) as the first real types to render.

## Out of scope (MVP)

- Convex / any database; auth; real-time/collab.
- `reference`/relation field type, multi-select, multi-tag-per-doc.
- Native shell (dev-dash WebView) wrapping — later packaging step.
- Roadmap/task (Linear) views and the rich Notion-style databases — later layers.
- Auto-migrating existing docs when a type's fields change.

## Open questions

- **Name** (working name "Atlas").
- **Single project first vs multi from slice 1?** Default: multi from slice 1 (it's the soul), but with a trivial config (a JSON list of repo paths) — not a fancy project manager yet.
- **Per-project vs shared types:** v1 reads each project's own `docs/.lore/types`. Shared/global types across projects = later.

## Decisions made (open to veto)

- New Next.js repo on `@lore/core`; tana-roam + dev-dash are parts donors, not reworked.
- Markdown files = source of truth; type schemas = YAML files in-repo (agent-parseable).
- User-definable types with custom fields is a first-class, early feature (Slice 2), not deferred.
- One type per document (not Tana multi-tag) for v1.
- Read-first browse ships first (Slice 1); type + doc editing follow.
