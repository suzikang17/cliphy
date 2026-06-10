# Cliphy docs index

The map of where project context lives. Human-readable and agent-readable — everything here is plain markdown in the repo, so Claude Code (and any editor or Obsidian vault pointed at `docs/`) can read it directly.

> Migrated from Notion on 2026-06-07. Notion is now a read-only archive; this repo is the source of truth.

## Where things live

| You want…                              | Look in                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Why a tech/tooling choice was made** | [`decisions/`](decisions/INDEX.md) — ADRs, one per decision                                                                                          |
| **Day-by-day build history**           | [`devlog/`](devlog/INDEX.md) — dated entries, Day 0 onward                                                                                           |
| **Open work / ideas / roadmap**        | [`ROADMAP.md`](ROADMAP.md) — open Task Board items                                                                                                   |
| **Completed work (archive)**           | [`task-archive.md`](task-archive.md) — finished tasks with notes                                                                                     |
| **Services, infra & cost**             | [`providers/`](providers/INDEX.md) — one record per provider (why/plan/cost); budget + env-var reference now in [`architecture.md`](architecture.md) |
| **Architecture & ops notes**           | [`architecture.md`](architecture.md) — Engineering Doc, Bizops, Workflow Automation, services/budget/env reference                                   |
| **Mobile app (Expo/RN)**               | [`mobile/`](mobile/INDEX.md) — architecture, feature set, gotchas, build/OTA deployment                                                              |
| **Marketing assets**                   | [`marketing/`](marketing/INDEX.md) — store listing + submission + promo tools, demo script                                                           |
| **Implementation plans**               | [`superpowers/plans/`](superpowers/plans/INDEX.md) — all plans (legacy `plans/` merged in)                                                           |
| **Design specs**                       | [`superpowers/specs/`](superpowers/specs/INDEX.md) — all design docs                                                                                 |

## Conventions

- Doc types are defined in [`.lore/types/`](.lore/types/) (lore schemas) — decisions, devlog, providers, plans, specs, marketing are one-file-per-record with generated INDEXes (`lore reindex <type>`); ROADMAP/task-archive/architecture stay consolidated.
- Notes are migrated **verbatim** from Notion — no summarizing.
- New entries are appended here going forward (see `CLAUDE.md` for the logging workflow). Do not write back to Notion.

## Optional add-ons (not adopted, documented for later)

- **Obsidian** — open this `docs/` folder as a vault for Notion-like browsing/graph over the same files. Zero lock-in; `[[wikilinks]]` work as-is.
- **Basic Memory** (MCP) — if you later want the agent to maintain structured, semantically-searchable memory in these markdown files.
- **Khoj** — if you ever want self-hosted "chat with the whole knowledge base."
