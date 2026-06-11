# Outliner daily notes — design + plan (demo slice)

**Date:** 2026-06-10
**Status:** Approved direction — "show me #1 first" (outliner _editing feel_; block refs explicitly deferred)

## What

A Tana/Roam-style **bullet outliner** in Atlas, demoed on a new **`note`** doc type (daily notes) where the body is a _pure markdown nested list_. Files stay clean markdown (the Logseq model); agents/lore read them natively. Existing doc types are untouched — their bodies contain headings/paragraphs that an outliner would mangle, so the outliner ships on a greenfield surface first.

## The `note` type (cliphy)

```yaml
name: note
dir: notes
heading: Notes
id: { strategy: dated }
body: free
frontmatter:
  - { name: title, type: string }
  - { name: date, type: date, required: true }
index:
  - { header: Date, source: date, format: date }
  - { header: Note, source: title, link: true }
```

One file per day: `docs/notes/2026-06-10-daily.md` (`title: "2026-06-10"` default). Body = nested `- ` list only.

## Atlas additions

1. **`OutlinerEditor`** (client component, Lexical): `{ value: string (markdown), name: string }` — renders a hidden input carrying serialized markdown for the existing form/server-action flow (drop-in alongside the textarea in DocForm).
   - Lexical `ListNode/ListItemNode` + `ListPlugin` + `TabIndentationPlugin` + `HistoryPlugin`; markdown in/out via `@lexical/markdown` with **UNORDERED_LIST transformer only** (pure outline).
   - Keys: Enter = sibling bullet, Tab/Shift-Tab = indent/outdent, Backspace at empty start = merge/outdent. Everything typed lives in a bullet (root is a list; initial empty doc = one empty bullet).
   - Styling: Tana-ish — muted bullet dots, indent guides, comfortable line height, dark theme consistent with Atlas.
   - Serialization on change → hidden input (form submit stays untouched server-side).
2. **DocForm**: when the type is `note` (v1: prop `outlinerBody: boolean` passed by pages when `schema.name === "note"`), render `OutlinerEditor` instead of the body textarea.
3. **"Today" button** — sidebar per-project link `Today` → route `/p/[project]/today` which finds-or-creates today's note (server-side: if no `docs/notes/<today>-*.md`, create via `writeDoc` with body `- `) and redirects to its edit page.
4. Note record page renders the outline (markdown lists already render; fine as-is).

## Out of scope (this slice)

Block refs/IDs/transclusion; outliner on other types' bodies; collapse-state persistence; zoom-into-bullet; slash commands; `[[` autocomplete inside the editor (wikilinks still work as text → already rendered on the record page).

## Plan

1. **(agent, atlas)** `OutlinerEditor` + DocForm wiring + `/today` route + sidebar link. Deps: `lexical @lexical/react @lexical/list @lexical/markdown @lexical/utils`. Tests: serialization round-trip helpers if extracted; otherwise UI verified by browser QA. Build + existing 27 tests stay green.
2. **(controller)** Seed `note` type in cliphy; browser QA: open Today → type bullets, Tab/indent, save → verify the markdown file is a clean nested list; reload → structure intact; lore validate/reindex green.
