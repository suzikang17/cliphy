---
title: "Notion → Repo Markdown Migration"
date: 2026-06-07
---

# Notion → Repo Markdown Migration

**Date:** 2026-06-07
**Goal:** Move all Cliphy context out of Notion into greppable, git-tracked markdown optimized for AI-agent context, and cut the auto-logging skills over to markdown. Notion becomes a read-only archive.

## Decisions (locked)

- **Full cutover** — migrate data AND rewire `CLAUDE.md` + `/devlog`, `/ship`, `/update-notion` skills to write markdown. Stop writing to Notion.
- **Everything, verbatim** — all 30 decisions, 21 devlog days, 103 task-board entries, 7 providers, budget, and doc pages carried over at full fidelity.
- **One file per record** for decisions and devlog. (Task board: open items → ROADMAP, completed → archive table — 103 single files would be noise.)
- **Leave Deckr alone** — Deckr HQ / Development Tasks (16) / Oracle Deck Studio PRD are a different project. Out of scope.

## Source inventory (Cliphy only)

| Notion source                                               | id                                     | count | → destination                                                   |
| ----------------------------------------------------------- | -------------------------------------- | ----- | --------------------------------------------------------------- |
| Decisions Log                                               | `42f62fe3-f22d-42e3-be34-da072f34667b` | 30    | `docs/decisions/NNNN-slug.md` + `INDEX.md`                      |
| Devlog                                                      | `1effdee5-dc77-4471-b230-cdca00227023` | 21    | `docs/devlog/day-NN-slug.md` + `INDEX.md`                       |
| Task Board                                                  | `2928b00e-9d27-47fc-a709-27cfd4b5c9e0` | 103   | `docs/ROADMAP.md` (open) + `docs/task-archive.md` (done, table) |
| Provider Tracker                                            | `6f862ea3-280f-44b9-9b38-d649338cb05f` | 7     | `docs/providers.md`                                             |
| Budget                                                      | `9486dce5-fedf-4274-a4bd-9e71f0c6ac7b` | 6     | merged into `docs/providers.md`                                 |
| Services & Providers (page)                                 | under Cliphy HQ                        | 1     | merged into `docs/providers.md`                                 |
| Engineering Doc / Bizops / Workflow Automation / Start Here | under Cliphy HQ → Docs                 | ~4    | `docs/architecture.md`                                          |
| Chrome Web Store Listing Draft / Demo Recording Script      | under task pages                       | 2     | `docs/marketing/`                                               |

## Tooling research outcome (2026-06-07)

Surveyed the market for "human-readable doc center that's also agent context." Findings:

- **Plain markdown in the git repo is the correct substrate** — high-star Notion-clones (AppFlowy 72k, AFFiNE 69k, SiYuan 44k, Trilium 36k) store data in a proprietary DB/CRDT, which breaks "git repo of markdown is source of truth." Agent-memory tools (mem0 58k, Graphiti 27k) are opaque vector/graph stores, not human-readable. RAG layers (Khoj 35k, Quivr 39k) read docs but don't author back.
- **Correction:** Claude Code reads `CLAUDE.md`, NOT `AGENTS.md` natively (common myth). So keep `CLAUDE.md` as the entrypoint + a `docs/INDEX.md` map. (If a 2nd agent tool is added later, make `CLAUDE.md` a one-line `@AGENTS.md` import.)
- **Keep the `docs/` folder Obsidian-vault-friendly** (it already uses `[[wikilinks]]`) → free Notion-like human browsing over the identical files, zero lock-in.
- **Add-later options (documented, not adopted now):** Basic Memory MCP (official read/write agent memory over plain markdown) if structured semantic search is wanted; Khoj (self-hosted "chat with everything") as a read-only search surface. `llms.txt` only matters if docs are ever published publicly.

## Target structure

```
CLAUDE.md            ← rewired: instructions only, Notion refs → markdown refs, points to docs/INDEX.md
docs/
  INDEX.md           ← NEW. Human+agent map of where each kind of context lives
  decisions/         ← 30 ADR files + INDEX.md
  devlog/            ← 21 dated files + INDEX.md
  providers.md       ← infra/services/cost + rationale
  architecture.md    ← Engineering Doc + Workflow Automation
  ROADMAP.md         ← open + idea task-board items
  task-archive.md    ← completed tasks, verbatim table
  marketing/         ← store listing + demo script
  plans/ specs/      ← untouched
```

## Phases

### Phase 0 — Scaffold (direct)

- Create `docs/{decisions,devlog,marketing}/` dirs.
- Write the four markdown templates (decision ADR, devlog entry, provider entry, roadmap item).
- Draft `AGENTS.md` skeleton with the repo map + index links.

### Phase 1 — Extract & write (parallel subagents, one per source)

Each subagent: `API-query-data-source` (paginated, all rows + all properties) → fetch block children for page bodies where present → format to template → write files. Verbatim, no summarizing.

- A: Decisions Log → 30 files (Decision / Why / Options Considered / Tradeoffs / Category / Date / Revisit) + INDEX.
- B: Devlog → 21 files (Day Number / Date / Phase / Mood / Hours / Tags + full body) + INDEX.
- C: Task Board → ROADMAP.md (Status≠Done) + task-archive.md (Status=Done, with Notes).
- D: Provider Tracker + Budget + Services page → providers.md.
- E: Doc pages → architecture.md + marketing/.

### Phase 2 — Rewire forward-logging (direct)

- `CLAUDE.md`: replace Notion integration / Session flow / Auto-logging sections with markdown equivalents; link AGENTS.md.
- `.claude/skills/devlog/SKILL.md`: append to `docs/devlog/` instead of Notion Devlog DB.
- `.claude/skills/update-notion/SKILL.md`: rename intent → update `docs/decisions/` + `docs/ROADMAP.md`.
- `.claude/skills/ship/SKILL.md`: drop Notion task-board update step, keep verify/commit/push.

### Phase 3 — Verify (subagent)

- Counts match (30 / 21 / 103 / 7).
- All INDEX links resolve; no dangling `[[refs]]`.
- Spot-check 3 random records per source against Notion for fidelity.
- Notion left intact (read-only archive) — nothing deleted.

## Out of scope / won't do

- Deleting anything from Notion (archive stays).
- Deckr content.
- `docs/devdash/` HTML (dead-end scaffolding; flag for deletion separately).

```

```
