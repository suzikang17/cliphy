# Roadmap: tasks, board, agent queue, references & backlinks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Task doc type with dev-dash's computed-kanban model + two-tier storage (BACKLOG.md → promote → `docs/tasks/`), `reference` fields, `[[wikilinks]]`, computed backlinks, Atlas board/backlog/backlinks UI, and the `owner: ai` agent-queue protocol. Spec: `/Users/suki/dev/cliphy/docs/superpowers/specs/2026-06-10-roadmap-tasks-links-design.md`.

**Repos:** `~/dev/lore` (workspace: packages/core 34 tests + packages/cli 2), `~/dev/atlas` (13 tests), `/Users/suki/dev/cliphy` (data). Regression bar everywhere: existing tests stay green; decisions/devlog INDEXes stay byte-stable.

---

## Final contracts

```ts
// @lore/core types.ts (additions)
fieldSchema: type enum += "reference"; + target?: string; + list: boolean (default false)
docTypeSchema: + groupBy?: { field: string; order: string[] (default []) }

// schema.ts
validateDoc(doc, schema, opts?: { refExists?: (ref: string) => boolean }): ValidationIssue[]
  // reference fields: list↔array shape check; refExists check per ref when callback provided

// backlinks.ts (new)
interface Backlink { fromType: string; fromFile: string; via: string }  // via = field name | "body"
buildLinkIndex(docsByType: Record<string, Doc[]>, schemas: Record<string, DocTypeSchema>): Map<string, string>
  // lowercase title AND lowercase fileBase → docsRoot-relative path (schema.dir + "/" + file); first wins
computeBacklinks(docsByType, schemas): Map<string, Backlink[]>
  // keys: docsRoot-relative target paths; sources: reference-field values + [[tokens]] in bodies
  // [[..]] scan skips fenced code blocks (inFence toggle, same pattern as extractSections)

// index-md.ts
renderIndex(docs, schema)  // if schema.groupBy: H2 "## <Group> (n)" per group, ordered by
                           // groupBy.order then alphabetical; per-group table; ungrouped behavior unchanged

// promote.ts (new)
promoteFromBacklog(docsRoot: string, schema: DocTypeSchema, query: string,
                   extraFields?: Record<string, unknown>): { file: string; line: string }
  // finds first line in <docsRoot>/BACKLOG.md case-insensitively containing query;
  // title = line minus leading "- [ ] "/"- "/"* " and trailing "(was CLIP-N)" (suffix kept in body);
  // writeDoc with { title, status: "open", owner: "none", created: <today from extraFields.created — caller passes it>, ...extraFields };
  // removes the line, rewrites BACKLOG.md, reindexes the type, returns file + original line. Throws if no match.

// cli: lore promote <type> <query...>  (+ optional --field k=v passthrough, incl. created=YYYY-MM-DD)
```

```
Atlas additions:
src/lib/links.ts        getBacklinks(project, path) + getLinkIndex(project)  (wraps core fns over loadProjects)
src/lib/board.ts        kanbanColumn(doc): "Backlog"|"Speccing"|"AI Working"|"Blocked"|"Review & QA"|"Done"  (spec table)
src/lib/backlog.ts      readBacklogLines(project): {line, idx}[]; promote server action wraps promoteFromBacklog
src/components/DocForm  + refCandidates?: Record<fieldName, {path, label}[]> → <select> storing path; list refs deferred to text input (comma-sep)
pages: /p/[project]/[type]/board   (Board tab; shown when schema has status+owner fields)
       /p/[project]/backlog        (BACKLOG.md lines + per-line Promote button)
record page: "Referenced in" panel (getBacklinks) + [[wikilink]] → anchor rewriting before marked()
```

---

## Task 1 (agent, lore repo): core — reference fields, backlinks, grouped INDEX, promote

**Files:** `packages/core/src/{types,schema,index-md}.ts`, new `packages/core/src/{backlinks,promote}.ts`, barrel `index.ts`, `packages/cli/src/cli/index.ts` (promote + validate refExists wiring), tests for each.

- [ ] TDD each contract above, in order: types → validateDoc(refs) → backlinks (buildLinkIndex + computeBacklinks incl. fence-skip test) → grouped renderIndex (incl. "ungrouped schemas byte-identical" regression test) → promoteFromBacklog (temp-dir test: creates file, strips prefix/suffix, removes line, throws on no-match).
- [ ] CLI: `validate` passes `refExists: (ref) => existsSync(join(docsRoot, ref))`; new `promote` command (`lore promote task proxy --field owner=human --field created=2026-06-10`) printing `promoted "<line>" -> <file>`.
- [ ] Bar: `pnpm -r test` green (36 existing + new), `pnpm -r build` clean. Then regression against real data: `cd /Users/suki/dev/cliphy/docs && node ~/dev/lore/packages/cli/dist/cli/index.js reindex decision && reindex devlog` → `git -C /Users/suki/dev/cliphy diff docs/decisions/INDEX.md docs/devlog/INDEX.md` must be EMPTY (report it).
- [ ] Commits: logical chunks, messages like `core: reference field type`, `core: backlinks`, `core: grouped index`, `core: promote from backlog`, `cli: promote command + ref validation`.

## Task 2 (agent, atlas repo): UI — board, backlog+promote, references, backlinks, wikilinks

**Files:** per contracts: `src/lib/{links,board,backlog}.ts` (+ vitest for `kanbanColumn` covering all 6 spec rows, and backlog line parsing), `src/lib/actions.ts` (+ promoteAction, and DocForm pages passing refCandidates), `src/components/DocForm.tsx` (reference selects), new pages `p/[project]/[type]/board/page.tsx` + `p/[project]/backlog/page.tsx`, record page (backlinks panel + wikilink rewrite), type page (Board link when schema has `status`+`owner` fields), sidebar (Backlog link per project).

- [ ] Rebuild/link first: `cd ~/dev/lore && pnpm -r build; cd ~/dev/atlas && pnpm install` — confirm new core exports import.
- [ ] Board page: group `getDocs(project, type)` by `kanbanColumn`, six fixed columns, cards = title + priority/effort + 🤖 (`owner==="ai"`) + 📋 (`ai_run`), card links to record page.
- [ ] Backlog page: lines from `<docsRoot>/BACKLOG.md` (skip blanks/headings), each with a Promote form button → `promoteAction(project, "task", line)` (action passes `created: today`) → redirect to the new task. Graceful empty state if no BACKLOG.md.
- [ ] Record page: `getBacklinks` panel ("Referenced in: <title> (type)" links); body: replace resolvable `[[token]]` (via `getLinkIndex`) with `[token](/p/<project>/<type>/<fileBase>)` BEFORE marked, leave unresolved tokens as plain text.
- [ ] DocForm: fields with `type: "reference"` render `<select name="field_<name>">` from `refCandidates` (label = title, value = path) with an empty option; pages (new/edit) compute candidates via `getDocs` for `field.target` (skip candidates when no target). `list: true` reference fields: plain text input (comma-sep paths) for v1.
- [ ] Bar: vitest green (13 existing + new), `pnpm build` clean, dev server on 4123, curls: `/p/cliphy/backlog` renders (empty-state ok pre-migration), board page 200s for a status+owner type once Task 3 lands (coordinate: implement generically; the controller verifies post-migration). Commit per logical chunk.

## Task 3 (controller, cliphy): migration + rewiring

- [ ] Seed `task` type via `createType` (tsx script, like prior types), then hand-tune `docs/.lore/types/task.schema.yaml` to the spec's full schema (enums for status/owner/priority/effort/type, `reference` fields `spec`/`plan` with targets, `groupBy: {field: status, order: [open, blocked, done, skipped]}`, index columns #/Task/Owner/Priority/Type/Completed).
- [ ] Migration script: parse `task-archive.md` (66 → files, `status: done`, Notes→body, Completed→completed, Type/Day mapped) + `ROADMAP.md` In Progress/To Do/Not started rows (→ files, `status: open, owner: human`, priority `🔴 High`→`high` etc, Notes→body) + Backlog rows (→ `docs/BACKLOG.md` lines `- [ ] <title> — <note> (was CLIP-N)`). File number = CLIP number. Unknown enum values → omit field.
- [ ] `lore validate task` → valid; `lore reindex task` → grouped INDEX; spot-check counts (66 done + N open files; ~25 backlog lines; total ids = 105).
- [ ] `git rm ROADMAP.md task-archive.md`; update `docs/INDEX.md` (tasks + backlog rows); update `CLAUDE.md` session-flow + add **Agent queue** section (protocol per spec); update `.claude/skills/update-docs/SKILL.md` + `devlog/SKILL.md` (task edits = frontmatter + reindex; capture → BACKLOG.md); new `.claude/skills/work-queue/SKILL.md` (list open+ai tasks → work → work log → ai_run:true, owner:human → reindex → commit).
- [ ] Commit.

## Task 4 (controller, browser): end-to-end dogfood

- [ ] Append a REAL line to BACKLOG.md (e.g. `- [ ] Add docs pre-commit hook running lore validate + reindex`).
- [ ] Browser: open `/p/cliphy/backlog` → Promote it → verify task file created + INDEX updated + redirect.
- [ ] Edit the task in Atlas: set `owner: ai` → verify board shows it in **AI Working**.
- [ ] Claude Code (the controller) executes the `/work-queue` protocol on it FOR REAL: implement the pre-commit hook, append `## Work log`, set `ai_run: true, owner: human`, reindex, commit → verify board shows **Review & QA**.
- [ ] Verify backlinks: add `spec:` ref on an existing task (e.g. 0073 → auto-tag design spec) and confirm the spec's record page shows "Referenced in".

---

## Self-Review

Spec coverage: reference/list+validation→T1; backlinks (fields+wikilinks, fence-safe, computed-not-stored)→T1/T2; grouped INDEX→T1; promote (CLI+UI)→T1/T2/T4; board (6 computed columns)→T2; backlog page→T2; DocForm refs→T2; wikilink render→T2; migration two-tier + CLIP continuity→T3; CLAUDE.md/skills rewire + /work-queue→T3; dogfood A-to-Z incl. agent hand-back→T4; decisions/devlog byte-stable→T1 bar. Placeholders: none — contracts are exact; agents have shown they implement from contracts+tests reliably in this codebase. Types consistent with existing exports (writeDoc/readDocs/renderIndex signatures unchanged except optional schema.groupBy; validateDoc gains optional 3rd arg — backward compatible).
