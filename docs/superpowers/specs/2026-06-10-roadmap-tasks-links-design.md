# Roadmap: tasks, board, agent queue, references & backlinks (design)

**Date:** 2026-06-10
**Status:** Design — for review
**Builds on:** lore (engine), Atlas (UI). **Source vision:** dev-dash specs `ai-task-runner-v2`, `bracket-linking`, `product-tab-md-entity-model` — translated from native-Swift/JSON onto the lore substrate.

## Goal

Make tasks first-class lore documents with dev-dash's ownership model, render them as a kanban board in Atlas, turn `owner: ai` into a real agent queue for Claude Code, and add the connective tissue the whole vision rests on: typed `reference` fields, `[[wikilinks]]`, and computed backlinks.

**Storage model — two tiers (the dev-dash ideas→task promote pipeline):**

```
BACKLOG.md            cheap lines — zero-ceremony capture, someday/maybe (not linkable, by design)
      │ promote       (Atlas button / `lore promote` / ask the agent)
docs/tasks/           per-file records — every task that became real work, active AND done
                      grouped INDEX + Atlas board; fully linkable + backlinkable, forever
```

A task becomes a file exactly when it needs an identity: it gets an owner, gets queued, gets linked, or lands on the board. "Needs to be linked" _is_ the promotion trigger. Done tasks stay as files (the decisions/devlog precedent: frozen history as per-file records is the most-linked part of the corpus). `ROADMAP.md` and `task-archive.md` both retire.

## The model (from dev-dash, kept faithfully)

**Task lifecycle stays lean; columns are computed, never stored:**

```yaml
# docs/tasks/0073-add-auto-tag-feature.md   (file number = CLIP number)
---
title: Add Auto-Tag feature for Pro users
status: open # open | blocked | done | skipped
owner: human # none | human | ai
ai_run: false # set true by the agent when it completes a run
priority: high # high | medium | low (enum)
effort: medium # small | medium | large (enum)
platform: extension, server # string for v1
type: feature # feature | bug | infra | test | chore (enum)
spec: superpowers/specs/2026-03-10-auto-tag-design.md # reference field
created: 2026-04-18
completed: # date
---
# Add Auto-Tag feature for Pro users
<free body: notes, work log>
```

**Computed kanban columns** (dev-dash table, verbatim):

| status         | owner | ai_run | → Column                         |
| -------------- | ----- | ------ | -------------------------------- |
| open           | none  | any    | **Backlog**                      |
| open           | human | false  | **Speccing** (your queue)        |
| open           | ai    | any    | **AI Working** (the agent queue) |
| blocked        | any   | any    | **Blocked**                      |
| open           | human | true   | **Review & QA**                  |
| done / skipped | any   | any    | **Done**                         |

## New lore core capabilities

1. **`reference` field type.** `{ name: spec, type: reference, target: spec }` (optional `target` restricts to a type; omit = any). Value = docsRoot-relative path (`superpowers/specs/foo.md`). `list: true` on the field allows arrays (`goalIds[]`-style). `validateDoc` checks each ref resolves to an existing file. Index/record rendering: link.
2. **Backlinks.** Core fn `computeBacklinks(project docs)` → map of `targetPath → [{fromType, fromFile, via}]`, gathered from (a) reference-field values and (b) `[[...]]` tokens in bodies (resolved by exact title or file base, case-insensitive, across all types). Pure function; no stored state — recomputed from files (the DevDash anti-drift principle).
3. **Grouped INDEX.** Schema `index` config gains `groupBy: <field>` + optional `groupOrder: [...]` → INDEX.md renders an H2 per group (the shape today's ROADMAP.md already has). Tasks group by `status`, order `[open, blocked, done, skipped]`.

## Atlas additions

1. **Board view** on the task type page (tab: Table | Board). Six computed columns per the table above; cards show title/priority/effort + a 🤖 badge for `owner: ai` and 📋 when `ai_run`. v1 interaction: click card → record page; status/owner change via the edit form (drag-and-drop later).
2. **Reference field inputs** in DocForm: a select/datalist of candidate docs (all docs of the target type), storing the path.
3. **Backlinks panel** ("Referenced in") on every record page — tasks show their spec, specs show their tasks. Powered by `computeBacklinks`.
4. **`[[wikilink]]` rendering** in record bodies: resolvable links become anchors; unresolved render as plain text with a muted style.

## The agent queue (protocol, not infrastructure)

dev-dash spawned `claude -p` per task; here **the files are the queue and Claude Code is already in the repo**:

- **Enqueue:** set `owner: ai` (in Atlas, or by editing the file, or by asking the agent).
- **Pick up:** Claude Code lists `docs/tasks/` for `status: open, owner: ai` (a `/work-queue` skill + CLAUDE.md section document the protocol).
- **Work:** the agent implements the task (normal session work), appending a `## Work log` to the task body (what was done, commits, decisions — the lightweight version of dev-dash's phases/release-notes).
- **Hand back:** on completion the agent sets `ai_run: true`, `owner: human` (→ Review & QA column), runs `lore reindex task`, commits. If genuinely stuck: `status: blocked` + a `## Blocked on` note.
- Deferred from the runner spec: live file/command streaming, `[PHASES:]` markers, auto manual-test files — the work log covers v1; phases can come back as frontmatter later.

## Migration & rewiring

- `task-archive.md` (66 done) → `docs/tasks/NNNN-slug.md` files, `status: done` (file number = CLIP number; sequential strategy handles gaps). Notes → body; Completed → `completed`.
- `ROADMAP.md` (39 open): **In Progress / To Do / Not started** rows (the committed ones, ~10-15) → task files with `owner: human`; **Backlog** rows → lines in a new `docs/BACKLOG.md` (`- [ ] title — note (was CLIP-N)`), preserving the CLIP id in the line for provenance.
- **Promote:** `lore promote` CLI (reads a backlog line, creates the task file, removes the line) + an Atlas "promote" button next to each backlog line (backlog page renders BACKLOG.md with per-line promote actions). The dev-dash ideas-board "→ task" flow, file-backed.
- Delete `ROADMAP.md` + `task-archive.md`; the grouped tasks INDEX + BACKLOG.md replace them. Update `docs/INDEX.md`.
- **Rewire CLAUDE.md + `/update-docs` + `/devlog` skills:** "move row between files" becomes "edit the task file's frontmatter + `lore reindex task`"; new-work capture goes to BACKLOG.md unless it's immediately real; add the agent-queue protocol section.

## Build order (one push, internally sequenced)

A. **lore:** reference type + list refs + validation; backlinks; grouped INDEX; `lore promote`. TDD; decisions/devlog regression must stay byte-stable.
B. **Migrate:** task type seeded via `createType` (then schema hand-tuned for references/groupBy), 66 done + committed-open tasks → files, backlog rows → BACKLOG.md, old files retired, CLAUDE.md/skills rewired.
C. **Atlas:** board view, backlog page with promote buttons, reference inputs, backlinks panel, wikilink rendering.
D. **Dogfood the queue end-to-end:** capture a line in BACKLOG.md → promote it in Atlas → set `owner: ai` → Claude Code picks it up via the protocol, works it, hands it back to Review & QA.

## Out of scope

- Drag-and-drop on the board; live phase streaming; auto manual-tests/release-notes; goals/initiatives/ideas types (next after tasks prove the link model); cross-project board; graph view.

## Decisions (open to veto)

- **Two-tier task storage** — BACKLOG.md lines for capture (not linkable, by design); per-file markdown for every task that becomes real, including done ones (linkable history, the decisions/devlog precedent). Reverses dev-dash's tasks-in-JSON choice because the writers are now humans + agents, not an app; `reindex` absorbs the churn. "Needs linking" is the promotion trigger.
- Reference values are **docsRoot-relative paths** (unambiguous, validateable, agent-friendly); `[[wikilinks]]` resolve by title/file-base for prose-level links.
- Computed columns, lean status — exactly dev-dash's model.
- File number = CLIP number (id continuity).
