# lore v2 — generalized doc types + devlog (design)

**Date:** 2026-06-07
**Status:** Design — approved for spec review
**Builds on:** v1 (`~/dev/lore`, decisions doc type)

## Goal

Generalize lore's core so a doc type is fully declarative (id scheme, body mode, INDEX columns all from the schema), then add **devlog** as the second type — dogfooded against Cliphy's 21 real devlog entries. Roadmap and providers stay deferred to v3 (they become ~just-a-schema-file once this lands).

## Why (what v1 hard-coded)

v1's core secretly assumes "decisions": `renderIndex` hard-codes the columns (#/Date/Decision/Category/Revisit), the id comes from a 4-digit filename prefix, and the body must be fixed named sections. Devlog breaks all three (date-named, freeform body, different columns), so the core must become schema-driven.

## The generalized schema language

A doc type gains three keys — `id`, `body`, `index`:

```yaml
name: decision
dir: decisions
heading: Decisions Log
id:
  strategy: sequential # numeric id from filename prefix; new files NNNN-slug.md
  pad: 4
body: sections # parse/enforce the named sections below
sections: [Why this choice, Options considered, Tradeoffs]
frontmatter:
  - { name: title, type: string, required: true }
  - { name: date, type: date, required: true }
  - { name: category, type: string }
  - { name: revisit, type: boolean }
index:
  - { header: "#", source: id }
  - { header: Date, source: date, format: date }
  - { header: Decision, source: title, link: true }
  - { header: Category, source: category }
  - { header: "Revisit?", source: revisit, format: yesno }
```

Devlog (the new type):

```yaml
name: devlog
dir: devlog
heading: Devlog
id:
  strategy: dated # sort by the `date` field; new files YYYY-MM-DD-slug.md;
  dateField: date # existing day-NN-*.md filenames are tolerated (date read from frontmatter)
body: free # body is freeform markdown; no enforced sections
frontmatter:
  - { name: title, type: string, required: true }
  - { name: date, type: date, required: true }
  - { name: day, type: number } # optional session number (metadata)
  - { name: phase, type: string }
  # mood / hours / tags / published_to / public are NOT declared — extra fields are tolerated (see core change #4)
index:
  - { header: Day, source: day }
  - { header: Date, source: date, format: date }
  - { header: Entry, source: title, link: true }
  - { header: Phase, source: phase }
```

## Core changes

1. **`types.ts`** — extend `docTypeSchema`:
   - `id`: `{ strategy: "sequential" | "dated", pad?: number, dateField?: string }`.
   - `body`: `"sections" | "free"` (default `"sections"` for back-compat).
   - `index`: array of `{ header, source, link?, format? }` where `source` is `"id"` or a frontmatter field name, `format` is `"date" | "yesno"`.
   - `Doc` gains `body: string` (raw markdown after the H1) alongside `sections`.

2. **`ids.ts` / `store.ts` / `parseDoc`** — id + filename per strategy. `parseDoc` must be **strategy-aware** so it doesn't mis-parse a date as a numeric id:
   - `sequential`: numeric id from `^(\d+)-(.+)\.md$` prefix; new file `padId(nextId)-slug.md` (today's behavior).
   - `dated`: numeric id is unused (NaN is fine); the sort key = the `dateField` value read from **frontmatter** (not the filename). New file `YYYY-MM-DD-slug.md`. Existing `day-NN-*.md` and `YYYY-MM-DD-*.md` filenames are both read fine because the date comes from frontmatter. The current `^(\d+)-` regex must NOT run for dated types (it would turn `2026-05-23-foo` into id=2026 / slug=`05-23-foo`); pass the strategy into `parseDoc`/`readDocs` so dated docs keep the full basename (minus `.md`) as the slug.

3. **`frontmatter.ts`** — `parseDoc` also populates `body` (content after the H1). `serializeDoc` gains a free-body path: for `body: free`, write frontmatter + optional H1 + the raw body unchanged (no section reflow).

4. **`schema.ts`** — `validateDoc`: for `body: free`, skip section checks; still validate frontmatter fields. Unknown/extra frontmatter fields are allowed (warn-free) so real devlog entries with `mood`/`hours`/`tags`/`published_to` pass.

5. **`index-md.ts`** — `renderIndex(docs, schema)` becomes **column-driven**: build the header row from `schema.index` headers; for each doc, emit each column by pulling `source` (id or frontmatter field), applying `format` (`date` → YYYY-MM-DD, `yesno` → yes/no), `link: true` → `[value](file)`, and escaping `|`. Sort: by id (sequential) or by date asc (dated). (renderIndex now takes the schema, not just a heading string.)

## Backward compatibility

- The decision schema gains explicit `id: {strategy: sequential, pad: 4}`, `body: sections`, and an `index:` block. Defaults (`sequential`, `sections`) mean the core behaves identically if those keys are omitted.
- After the change, `lore reindex decision` must still produce the same decisions INDEX (golden test).

## Existing devlog files

The 21 migrated entries are named `day-NN-slug.md` (+ 2 already `YYYY-MM-DD-slug.md`). Under the `dated` strategy lore reads each entry's `date` from frontmatter and tolerates any filename, so **the old files are left as-is** (matching the updated devlog skill). Only new entries created by `lore add devlog` use `YYYY-MM-DD-slug.md`.

## Dogfood

- Add `docs/.lore/types/devlog.schema.yaml` to Cliphy.
- `lore validate devlog` against the 21 real entries → must be `valid` (frontmatter present; extra fields tolerated).
- `lore reindex devlog` → generate `docs/devlog/INDEX.md` (Day | Date | Entry | Phase), sorted by date. Compare to the existing hand-built INDEX (data-identical expected; cosmetic diffs OK).
- `lore reindex decision` → unchanged decisions INDEX (regression check).

## Testing

- Unit: `dated` id/sort; `body: free` parse + serialize round-trip; column-driven `renderIndex` (link, date, yesno formats, pipe escaping); validate skips sections for free body and tolerates extra frontmatter fields.
- Golden: decisions INDEX unchanged; devlog INDEX over the 21 entries.

## Out of scope (v2)

- Roadmap and providers doc types (v3 — each becomes a schema file).
- In-TUI editing, the browser/web layer, semantic search.
- Renaming existing `day-NN` devlog files (left as-is by design).

## Decisions made (open to veto)

- Devlog files are **date-named** (`YYYY-MM-DD-slug.md`); `day` is optional frontmatter metadata + an INDEX column (per the updated devlog skill).
- `id.strategy` has exactly two modes for v2: `sequential`, `dated`.
- Extra frontmatter fields are tolerated, not declared, so real devlog entries pass without listing every field (`mood`/`hours`/`tags`/`published_to`/`public`).
- `renderIndex` signature changes to take the schema (column-driven).
