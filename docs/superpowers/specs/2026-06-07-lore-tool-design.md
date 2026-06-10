---
title: "`lore` — Git-native project knowledge base (design)"
date: 2026-06-07
---

# `lore` — Git-native project knowledge base (design)

**Date:** 2026-06-07
**Status:** Design — approved for spec review
**Working name:** `lore` (provisional)

## Problem

Project context (decisions, devlog, roadmap, providers) should be both **human-parseable** and **agent-parseable**, living as plain markdown in the repo. Cliphy just migrated off Notion to exactly this (`docs/`). But the existing tools each miss something for this use case:

- **General PKM tools** (Obsidian, Logseq) aren't project-context-native — not shaped around software-project knowledge living in the repo, versioned with code.
- It's always **human-first with bolted-on agent access, or agent-first that humans can't read** — nothing treats both as equal first-class citizens.
- Plain markdown is **too freeform** (no enforced structure); structured tools (Notion DBs, Basic Memory) impose a format you can't fully own or git-diff cleanly.
- **Reliable agent-maintained knowledge** (consistent format, no dupes, correct indexes) isn't solved well by any of them.

Motivation to build rather than adopt: **control / no lock-in**, a **specific gap** (above), and a possible **product**.

## Lessons from DevDash (the prior attempt)

DevDash was an earlier macOS app at this same problem (its export is the now-removed `docs/devdash/`). What made it hard, and the principle each lesson forces:

1. **UI state drifted from the files** — the app kept its own model and it desynced from the underlying markdown.
   → **Principle: markdown files are the single source of truth.** Every frontend is a stateless, regenerable _view_ plus thin _writes_ through the core. No frontend keeps its own authoritative model.
2. **Structure wasn't enforced** — without a schema the markdown drifted into inconsistent shapes the app couldn't reliably parse or render.
   → **Principle: structure is enforced by a schema that lives in the repo.** The core only operates on schema-valid docs; `validate` is the gate.

## North-star (future, NOT v1)

A **browser web app** as the presentation layer, able to show **multiple projects** in one view. The terminal TUI (v1) is the stopgap for single-repo access where you already are with Claude Code. The web app is a _later, additional thin frontend over the same core_ — not a rewrite. v1 must not block it.

## Core principles

1. **Files are the source of truth** — plain markdown + YAML frontmatter in the target repo; git-diffable; no database.
2. **One core, thin stateless frontends** — all logic lives in a pure core; CLI, TUI (and later the web app) are thin wrappers. Frontends never hold authoritative state.
3. **Structure without lock-in** — the doc-type schema lives in the _target repo_ (`docs/.lore/`), owned by the project, not the tool.
4. **Presentation-agnostic & multi-project-ready core** — the core operates on a given docs path and returns plain data. Multi-project later = run it over N paths and aggregate. No single-project assumptions baked in.
5. **Runs in-repo, zero hookup** — invoked from within the repo on `./docs`; not a separate project you switch into. Extractable into a standalone product later.

## v1 scope (vertical slice)

One doc type — **decisions (ADRs)** — dogfooded against Cliphy's existing 35 decisions. Touches all four layers thinly: schema, core, agent/human writes, and a human view (TUI).

### Components (one package)

1. **Core (pure functions)** — the only place logic lives; fully unit-tested.
   - Parse/serialize markdown + YAML frontmatter (round-trip stable).
   - Validate a doc against its type schema.
   - Allocate IDs (zero-padded sequential) and generate slugs.
   - Rebuild `INDEX.md` deterministically from the files.
   - In-memory list/filter/search over parsed docs.
   - All functions take a docs path + schema and return plain data — presentation-agnostic.

2. **CLI** (`lore …`) — thin wrapper over core:
   - `lore add decision` — interactive prompts or flags; writes a guaranteed-correct `NNNN-slug.md` and reindexes.
   - `lore reindex` — rebuild `INDEX.md` from the files.
   - `lore validate` — check every doc against the schema; report issues; **nonzero exit** so it works as a pre-commit hook.
   - `lore list` / `lore search <query>` — quick terminal queries.

3. **TUI** (Ink — React for the terminal) — the "another window" beside Claude Code:
   - List decisions; filter/search; read one in a detail pane; trigger `add`.
   - **Read-focused** in v1 (no full in-TUI editing). It renders from the files each time — never a separate model.

4. **Schema in the target repo** — `docs/.lore/types/decision.yaml`:
   - Frontmatter fields: `title`, `date`, `category`, `revisit`.
   - Body sections: `Why this choice`, `Options considered`, `Tradeoffs`.
   - Owned by the project; the tool enforces it.

### Write paths (both supported)

- **Free-write** — agent or human edits markdown directly per the conventions; `validate` / `reindex` (optionally a pre-commit hook) keeps the index and schema honest.
- **`lore add`** — guaranteed-correct numbering/frontmatter/index at write time.

Either way, correctness is recoverable because the files are the source of truth and `reindex`/`validate` are deterministic.

### Where it lives / invocation

Its own package/repo (extractable product), but **invoked from within the target repo** — `npx lore` / `pnpm lore` (or `npm link` during development) operating on `./docs`. A small `lore.config.*` (or `docs/.lore/`) declares where docs live and which types exist.

## Data model

- A decision is one file `docs/decisions/NNNN-slug.md`: YAML frontmatter (`date`, `title`, `category`, `revisit`) + H1 + the three body sections.
- `docs/decisions/INDEX.md` is **generated** — never hand-edited; rebuilt by `reindex`.
- This is byte-compatible with the files produced by the 2026-06-07 Notion migration.

## Testing

- **Core unit tests:** schema validation (valid/invalid cases), ID allocation (sequential, gap handling), slug generation, `INDEX.md` rebuild, parse↔serialize round-trip stability.
- **Golden test:** load Cliphy's real 35 decisions → `reindex` produces a byte-identical (or intentionally-diffed) `INDEX.md`; `validate` reports clean.

## Out of scope / non-goals (v1)

- Other doc types (devlog, roadmap, providers) — added once the one-type slice proves the shape.
- MCP server — deliberately omitted; the agent already edits files in-repo natively, and `lore add` covers reliable writes without an MCP hookup.
- Full in-TUI editing, the browser web app, multi-project aggregation — north-star, not now.
- Semantic search / embeddings, auth, hosting, real-time sync.
- A frontend that holds its own authoritative state (the DevDash trap).

## Decisions made (open to veto)

- Name `lore` (provisional).
- TUI built with **Ink** (TS/React fit).
- Schema as **YAML** in `docs/.lore/types/` (alternative: TS for type-safety — rejected for v1 in favor of declarative simplicity).
- v1 TUI is **read + trigger-add**, not full editing.
- **Decisions** as the first (only) v1 doc type.
- Package developed in its own repo, **run in-repo** against Cliphy's `docs/` for dogfooding.
