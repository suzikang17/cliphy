---
day: 66
date: 2026-06-10
phase: Growth
title: "Day 66 — Notion→markdown migration, lore engine, Atlas workspace MVP"
---

# Day 66 — Notion→markdown migration, lore engine, Atlas workspace MVP

**Session summary:** Migrated all Cliphy context out of Notion into repo markdown, then built the tooling vision on top of it: `lore` (markdown doc-type engine + CLI/TUI, `~/dev/lore`) and `Atlas` (multi-project workspace web app, `~/dev/atlas`). Atlas MVP slices 0–3 all shipped: read browse, type editor, doc create/edit — all over `@lore/core`, markdown as source of truth.

## What got done

- Notion → `docs/` markdown migration: 35 decisions (ADRs), 21 devlog entries, 105 tasks (ROADMAP + archive), providers, architecture; CLAUDE.md + skills rewired (`/update-notion` → `/update-docs`); Notion now read-only archive
- lore v1–v2: schema-driven doc types (`docs/.lore/types/*.yaml`), sequential/dated id strategies, sectioned/free bodies, column-driven INDEX generation, CLI (list/search/add/reindex/validate) + Ink TUI; dogfooded on real decisions + devlog
- lore monorepo split: `@lore/core` + `lore` CLI packages (30 tests)
- Atlas slices 0–3: Next.js 16 app over `@lore/core`; multi-project config; browse pages; **type editor** (New Type / Add Field UI writing schema YAML); **doc create/edit** (schema-driven field inputs, all 5 field types) — 13 tests + browser QA
- Consolidation decision: lore = engine, Atlas = the one UI; tana-roam + dev-dash = parts donors

## Decisions

- Markdown-in-repo over Notion/DB substrates for agent-parseable context (research: high-star Notion-clones all DB-backed)
- One type per document (not Tana multi-tag); devlogs date-named with `day:` as metadata
- Edit preserves filename (no renumber on title change)

## Issues

- lore `resolveConfig` only walked up, missing `docs/.lore` from repo root — fixed + tested
- 4 bugs in v1 core caught by review (fenced-code `##` section splitting, Date serialization, pipe escaping) — fixed + tested
- `number` field type missing from schema enum — caught by devlog dogfood

## What to remember

- Atlas dev: `cd ~/dev/atlas && pnpm dev --port 4123`; projects in `atlas.config.json`
- lore CLI: `node ~/dev/lore/packages/cli/dist/cli/index.js <cmd> <type>` (alias needs updating post-monorepo)
- Parallel sessions write decisions/devlogs concurrently — files-as-truth handles it

---

## Addendum (same day): roadmap — tasks, board, agent queue, links

- lore: `reference` field type (+ validation), computed backlinks + `[[wikilinks]]`, grouped INDEXes, `lore promote` (86 tests)
- Atlas: kanban board (computed columns), backlog page with promote, reference inputs, "Referenced in" panel, wikilink rendering
- Migrated 105 CLIP tasks → two-tier model: `docs/tasks/` (12 open + 65 done) + `BACKLOG.md` (31 capture lines); ROADMAP/task-archive retired; `/work-queue` skill added
- **Dogfooded the agent queue end-to-end:** backlog line → promoted in Atlas → `owner: ai` → agent implemented docs pre-commit validation (`scripts/validate-docs.sh`) → handed back to Review & QA. The new hook validated its own delivery commit.
- Gotcha: pnpm `file:` deps snapshot at install (stale on lore rebuilds → `pnpm run sync:core`); Turbopack can't traverse symlinks outside the project root (`link:` protocol unusable).
