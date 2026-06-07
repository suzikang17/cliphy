# Cliphy docs index

The map of where project context lives. Human-readable and agent-readable — everything here is plain markdown in the repo, so Claude Code (and any editor or Obsidian vault pointed at `docs/`) can read it directly.

> Migrated from Notion on 2026-06-07. Notion is now a read-only archive; this repo is the source of truth.

## Where things live

| You want…                              | Look in                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Why a tech/tooling choice was made** | [`decisions/`](decisions/INDEX.md) — 35 ADRs, one per decision                                             |
| **Day-by-day build history**           | [`devlog/`](devlog/INDEX.md) — 21 dated entries, Day 0 → Day 62                                            |
| **Open work / ideas / roadmap**        | [`ROADMAP.md`](ROADMAP.md) — 39 open Task Board items                                                      |
| **Completed work (archive)**           | [`task-archive.md`](task-archive.md) — 66 finished tasks with notes                                        |
| **Services, infra & cost**             | [`providers.md`](providers.md) — Provider Tracker + Budget + env vars                                      |
| **Architecture & ops notes**           | [`architecture.md`](architecture.md) — Engineering Doc, Bizops, Workflow Automation                        |
| **Marketing assets**                   | [`marketing/`](marketing/) — store listing, demo script                                                    |
| **Feature plans & specs**              | [`plans/`](plans/), [`superpowers/plans/`](superpowers/plans/), [`superpowers/specs/`](superpowers/specs/) |

## Conventions

- **Decisions** and **devlog** are one-file-per-record (greppable, individually linkable). Everything else is a consolidated file.
- Notes are migrated **verbatim** from Notion — no summarizing.
- New entries are appended here going forward (see `CLAUDE.md` for the logging workflow). Do not write back to Notion.

## Optional add-ons (not adopted, documented for later)

- **Obsidian** — open this `docs/` folder as a vault for Notion-like browsing/graph over the same files. Zero lock-in; `[[wikilinks]]` work as-is.
- **Basic Memory** (MCP) — if you later want the agent to maintain structured, semantically-searchable memory in these markdown files.
- **Khoj** — if you ever want self-hosted "chat with the whole knowledge base."
