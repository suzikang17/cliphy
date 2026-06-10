---
title: "lore v2 — generalized doc types + devlog — Implementation Plan"
date: 2026-06-07
---

# lore v2 — generalized doc types + devlog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Generalize lore's core so a doc type's id scheme, body mode, and INDEX columns are all schema-driven, then add the **devlog** doc type, dogfooded against Cliphy's 21 real devlog entries.

**Architecture:** Extend the declarative schema with `id` (sequential|dated), `body` (sections|free), and `index` (columns). Thread the schema through `parseDoc`/`readDocs`/`writeDoc`/`renderIndex`. Decisions keep working via defaults (sequential + sections); a golden test enforces the decisions INDEX is unchanged.

**Tech Stack:** Existing lore repo `~/dev/lore` (TS/ESM, Vitest, gray-matter, yaml, zod, ink). Work from `~/dev/lore`. Spec: `/Users/suki/dev/cliphy/docs/superpowers/specs/2026-06-07-lore-v2-devlog-design.md`.

**Confirmed simplification:** `validateDoc` already iterates only declared frontmatter fields and never checks sections — so extra fields are already tolerated and free-body needs no validate change. No schema.ts change in v2.

---

## Final contracts (used consistently across tasks)

```ts
// types.ts
DocTypeSchema = { name, dir, heading?, id: IdConfig, body: "sections"|"free",
                  frontmatter: DocTypeField[], sections: string[], index: IndexColumn[] }
IdConfig    = { strategy: "sequential"|"dated", pad: number, dateField: string }
IndexColumn = { header: string, source: string /* "id" | frontmatter field */,
                link: boolean, format?: "date"|"yesno" }
Doc         = { id, slug, file, frontmatter, sections, body: string, raw }

// frontmatter.ts
parseDoc(file, raw, strategy: "sequential"|"dated" = "sequential"): Doc
serializeDoc(frontmatter, title, sections, order): string          // sectioned (unchanged)
serializeFreeDoc(frontmatter, body): string                         // free body (new)

// ids.ts
slugify(s): string                 // unchanged
nextId(ids): number                // unchanged
padId(n, pad = 4): string          // pad arg added

// store.ts
readDocs(dir, schema): Doc[]                                         // strategy-aware parse + sort
writeDoc(dir, schema, input: { frontmatter, title, sections?, body? }): string

// index-md.ts
renderIndex(docs, schema): string  // column-driven (signature changed from (docs, heading))
```

---

## Task 1: Extend types.ts

**Files:** Modify `src/core/types.ts`

- [ ] **Step 1: Add id/index zod schemas, extend docTypeSchema, add Doc.body**

Replace the `docTypeSchema` block and `Doc` interface with:

```ts
export const idConfigSchema = z.object({
  strategy: z.enum(["sequential", "dated"]).default("sequential"),
  pad: z.number().default(4),
  dateField: z.string().default("date"),
});
export type IdConfig = z.infer<typeof idConfigSchema>;

export const indexColumnSchema = z.object({
  header: z.string(),
  source: z.string(), // "id" or a frontmatter field name
  link: z.boolean().default(false),
  format: z.enum(["date", "yesno"]).optional(),
});
export type IndexColumn = z.infer<typeof indexColumnSchema>;

export const docTypeSchema = z.object({
  name: z.string(),
  dir: z.string(),
  heading: z.string().optional(),
  id: idConfigSchema.default({ strategy: "sequential", pad: 4, dateField: "date" }),
  body: z.enum(["sections", "free"]).default("sections"),
  frontmatter: z.array(fieldSchema),
  sections: z.array(z.string()).default([]),
  index: z.array(indexColumnSchema).default([]),
});
export type DocTypeSchema = z.infer<typeof docTypeSchema>;

export interface Doc {
  id: number; // sequential id from filename; NaN for dated types
  slug: string;
  file: string;
  frontmatter: Record<string, unknown>;
  sections: Record<string, string>;
  body: string; // raw markdown body (gray-matter content)
  raw: string;
}
```

(Keep the existing `fieldSchema`/`DocTypeField` and `ValidationIssue` as-is.)

- [ ] **Step 2: Typecheck.** `cd ~/dev/lore && pnpm build` → must pass (other files not yet updated may error on `Doc.body` / `renderIndex` signature — that's expected; if so, just confirm `types.ts` itself has no errors via `pnpm exec tsc --noEmit` ignoring downstream, or proceed and let later tasks fix call sites). Commit regardless once types.ts is correct.

- [ ] **Step 3: Commit.** `git add src/core/types.ts && git commit -m "extend schema with id/body/index config"`

---

## Task 2: Strategy-aware parseDoc + body + free serialize

**Files:** Modify `src/core/frontmatter.ts`, `test/core/frontmatter.test.ts`

- [ ] **Step 1: Add failing tests** (append inside the existing `describe` blocks or add new ones)

```ts
import { parseDoc, serializeDoc, serializeFreeDoc } from "../../src/core/frontmatter.js";

describe("parseDoc strategy", () => {
  it("dated strategy keeps full basename as slug, id is NaN", () => {
    const d = parseDoc(
      "2026-05-23-auto-subs.md",
      `---\ntitle: "X"\ndate: 2026-05-23\n---\n\n# X\n\nfree body here\n`,
      "dated",
    );
    expect(Number.isNaN(d.id)).toBe(true);
    expect(d.slug).toBe("2026-05-23-auto-subs");
    expect(d.body).toContain("free body here");
  });
  it("sequential strategy still extracts numeric id", () => {
    const d = parseDoc("0007-foo.md", `---\ntitle: "F"\n---\n\n# F\n`, "sequential");
    expect(d.id).toBe(7);
    expect(d.slug).toBe("foo");
  });
});

describe("serializeFreeDoc", () => {
  it("writes frontmatter + raw body, round-trips", () => {
    const fm = { title: "Day 5", date: "2026-02-21", day: 5 };
    const body = "# Day 5\n\nDid stuff.\n\n- a\n- b\n";
    const out = serializeFreeDoc(fm, body);
    const d = parseDoc("2026-02-21-day-5.md", out, "dated");
    expect(d.frontmatter.title).toBe("Day 5");
    expect(d.body.trim()).toBe(body.trim());
  });
});
```

- [ ] **Step 2: Run, confirm fail.** `cd ~/dev/lore && pnpm vitest run test/core/frontmatter.test.ts` → FAIL.

- [ ] **Step 3: Update `src/core/frontmatter.ts`**

````ts
import matter from "gray-matter";
import type { Doc } from "./types.js";

const ID_RE = /^(\d+)-(.+)\.md$/;

export function parseDoc(
  file: string,
  raw: string,
  strategy: "sequential" | "dated" = "sequential",
): Doc {
  const { data, content } = matter(raw);
  let id = NaN;
  let slug = file.replace(/\.md$/, "");
  if (strategy === "sequential") {
    const m = file.match(ID_RE);
    if (m) {
      id = parseInt(m[1], 10);
      slug = m[2];
    }
  }
  return {
    id,
    slug,
    file,
    frontmatter: data,
    sections: extractSections(content),
    body: content,
    raw,
  };
}

function extractSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split("\n");
  let current: string | null = null;
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    if (current) sections[current] = buf.join("\n").trim();
  };
  for (const line of lines) {
    if (line.match(/^```/)) inFence = !inFence;
    const h2 = !inFence && line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      flush();
      current = h2[1];
      buf = [];
    } else if (current) buf.push(line);
  }
  flush();
  return sections;
}

function normalizeFrontmatter(fm: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm))
    out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  return out;
}

export function serializeDoc(
  frontmatter: Record<string, unknown>,
  title: string,
  sections: Record<string, string>,
  order: string[],
): string {
  const body = [`# ${title}`, ""];
  for (const name of order) {
    const text = sections[name];
    if (text && text.trim()) body.push(`## ${name}`, "", text.trim(), "");
  }
  return matter.stringify(body.join("\n") + "\n", normalizeFrontmatter(frontmatter));
}

export function serializeFreeDoc(frontmatter: Record<string, unknown>, body: string): string {
  return matter.stringify(
    body.endsWith("\n") ? body : body + "\n",
    normalizeFrontmatter(frontmatter),
  );
}
````

(This preserves the v1 fence-tracking and Date-normalization fixes.)

- [ ] **Step 4: Run, confirm pass.** `cd ~/dev/lore && pnpm vitest run test/core/frontmatter.test.ts` → PASS.

- [ ] **Step 5: Commit.** `git add src/core/frontmatter.ts test/core/frontmatter.test.ts && git commit -m "strategy-aware parseDoc + free-body serialize"`

---

## Task 3: store + ids generalization

**Files:** Modify `src/core/ids.ts`, `src/core/store.ts`, `test/core/store.test.ts`, `test/core/ids.test.ts`

- [ ] **Step 1: Update padId test** (in `test/core/ids.test.ts`, replace the padId test)

```ts
it("padId zero-pads to a width (default 4)", () => {
  expect(padId(7)).toBe("0007");
  expect(padId(7, 2)).toBe("07");
});
```

- [ ] **Step 2: Update `src/core/ids.ts` padId**

```ts
export function padId(n: number, pad = 4): string {
  return String(n).padStart(pad, "0");
}
```

(Keep `slugify` and `nextId` unchanged.)

- [ ] **Step 3: Add failing store tests** (append to `test/core/store.test.ts`; the file's existing `beforeEach` writes 0001-a / 0002-b sequential decisions)

```ts
import { docTypeSchema } from "../../src/core/types.js";
const seqSchema = docTypeSchema.parse({
  name: "decision",
  dir: "decisions",
  frontmatter: [],
  sections: [],
});
const datedSchema = docTypeSchema.parse({
  name: "devlog",
  dir: "devlog",
  id: { strategy: "dated" },
  body: "free",
  frontmatter: [],
});

it("readDocs(dir, seqSchema) sorts by numeric id", () => {
  expect(readDocs(dir, seqSchema).map((d) => d.id)).toEqual([1, 2]);
});

it("readDocs(dir, datedSchema) sorts by date frontmatter and tolerates non-numeric filenames", () => {
  // write dated-style files into a fresh dir
  const ddir = join(root, "devlog");
  mkdirSync(ddir, { recursive: true });
  writeFileSync(join(ddir, "day-09-x.md"), `---\ntitle: "X"\ndate: 2026-02-27\n---\n\n# X\n`);
  writeFileSync(join(ddir, "2026-05-23-y.md"), `---\ntitle: "Y"\ndate: 2026-05-23\n---\n\n# Y\n`);
  const docs = readDocs(ddir, datedSchema);
  expect(docs.map((d) => d.frontmatter.title)).toEqual(["X", "Y"]); // date asc
});

it("writeDoc dated builds YYYY-MM-DD-slug.md from the date field, free body", () => {
  const ddir = join(root, "devlog2");
  mkdirSync(ddir, { recursive: true });
  const file = writeDoc(ddir, datedSchema, {
    frontmatter: { title: "Day 7", date: "2026-02-24" },
    title: "Day 7",
    body: "# Day 7\n\nstuff\n",
  });
  expect(file).toBe("2026-02-24-day-7.md");
  expect(readFileSync(join(ddir, file), "utf8")).toContain("stuff");
});
```

- [ ] **Step 4: Rewrite `src/core/store.ts`**

```ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDoc, serializeDoc, serializeFreeDoc } from "./frontmatter.js";
import { nextId, padId, slugify } from "./ids.js";
import type { Doc, DocTypeSchema } from "./types.js";

export function readDocs(dir: string, schema: DocTypeSchema): Doc[] {
  const docs = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "index.md")
    .map((f) => parseDoc(f, readFileSync(join(dir, f), "utf8"), schema.id.strategy));
  if (schema.id.strategy === "dated") {
    const key = (d: Doc) => String(d.frontmatter[schema.id.dateField] ?? "");
    return docs.sort((a, b) => key(a).localeCompare(key(b)));
  }
  return docs.sort((a, b) => a.id - b.id);
}

export interface NewDoc {
  frontmatter: Record<string, unknown>;
  title: string;
  sections?: Record<string, string>;
  body?: string;
}

export function writeDoc(dir: string, schema: DocTypeSchema, input: NewDoc): string {
  let file: string;
  if (schema.id.strategy === "dated") {
    const date = String(input.frontmatter[schema.id.dateField] ?? "").slice(0, 10);
    file = `${date}-${slugify(input.title)}.md`;
  } else {
    const ids = readDocs(dir, schema)
      .map((d) => d.id)
      .filter((n) => !Number.isNaN(n));
    file = `${padId(nextId(ids), schema.id.pad)}-${slugify(input.title)}.md`;
  }
  const content =
    schema.body === "free"
      ? serializeFreeDoc(input.frontmatter, input.body ?? `# ${input.title}\n`)
      : serializeDoc(input.frontmatter, input.title, input.sections ?? {}, schema.sections);
  writeFileSync(join(dir, file), content);
  return file;
}
```

- [ ] **Step 5: Run tests.** `cd ~/dev/lore && pnpm vitest run test/core/store.test.ts test/core/ids.test.ts` → PASS (update the existing store test's `readDocs(dir)` calls to `readDocs(dir, seqSchema)` if any fail to compile).

- [ ] **Step 6: Commit.** `git add src/core/ids.ts src/core/store.ts test/core/store.test.ts test/core/ids.test.ts && git commit -m "generalize store/ids for dated strategy + free body"`

---

## Task 4: Column-driven renderIndex

**Files:** Modify `src/core/index-md.ts`, `test/core/index-md.test.ts`, `test/fixtures/decision.schema.yaml`

- [ ] **Step 1: Add the `index` block to `test/fixtures/decision.schema.yaml`** (append):

```yaml
index:
  - { header: "#", source: id }
  - { header: Date, source: date, format: date }
  - { header: Decision, source: title, link: true }
  - { header: Category, source: category }
  - { header: "Revisit?", source: revisit, format: yesno }
```

- [ ] **Step 2: Rewrite the index-md test** (`test/core/index-md.test.ts`) to use the schema

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderIndex } from "../../src/core/index-md.js";
import { readDocs } from "../../src/core/store.js";
import { loadSchema } from "../../src/core/schema.js";

const dir = fileURLToPath(new URL("../fixtures/decisions", import.meta.url));
const schema = loadSchema(
  readFileSync(fileURLToPath(new URL("../fixtures/decision.schema.yaml", import.meta.url)), "utf8"),
);

describe("renderIndex", () => {
  it("renders schema-driven columns, deterministically", () => {
    const docs = readDocs(dir, schema);
    const out = renderIndex(docs, schema);
    expect(out).toContain("# Decisions Log");
    expect(out).toContain("| # | Date | Decision | Category | Revisit? |");
    const rows = out.split("\n").filter((l) => /^\| \d{4} \|/.test(l));
    expect(rows).toHaveLength(docs.length);
    expect(renderIndex(docs, schema)).toBe(out);
  });
  it("formats date and yesno, links the title, escapes pipes", () => {
    const docs = readDocs(dir, schema);
    const out = renderIndex(docs, schema);
    expect(out).toMatch(/\| \d{4}-\d{2}-\d{2} \|/); // date YYYY-MM-DD
    expect(out).toMatch(/\| (yes|no) \|/); // yesno
    expect(out).toMatch(/\[[^\]]+\]\(\d{4}-[^)]+\.md\)/); // linked title
  });
});
```

- [ ] **Step 3: Run, confirm fail.** `cd ~/dev/lore && pnpm vitest run test/core/index-md.test.ts` → FAIL.

- [ ] **Step 4: Rewrite `src/core/index-md.ts`**

```ts
import { padId } from "./ids.js";
import type { Doc, DocTypeSchema, IndexColumn } from "./types.js";

function fmtDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v == null ? "—" : String(v);
}
function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|");
}
function cellValue(doc: Doc, col: IndexColumn, pad: number): string {
  let raw: unknown;
  if (col.source === "id") raw = Number.isNaN(doc.id) ? "" : padId(doc.id, pad);
  else raw = doc.frontmatter[col.source];
  let s: string;
  if (col.format === "date") s = fmtDate(raw);
  else if (col.format === "yesno") s = raw ? "yes" : "no";
  else s = raw == null || raw === "" ? "—" : escapeCell(String(raw));
  if (col.link) s = `[${s === "—" ? doc.slug : s}](${doc.file})`;
  return s;
}

export function renderIndex(docs: Doc[], schema: DocTypeSchema): string {
  const heading = schema.heading ?? `${schema.name[0].toUpperCase()}${schema.name.slice(1)}s`;
  const cols = schema.index;
  const lines = [
    `# ${heading}`,
    "",
    "Generated by lore — do not edit by hand.",
    "",
    `| ${cols.map((c) => c.header).join(" | ")} |`,
    `|${cols.map(() => "---").join("|")}|`,
  ];
  const sorted =
    schema.id.strategy === "dated"
      ? [...docs].sort((a, b) =>
          String(a.frontmatter[schema.id.dateField] ?? "").localeCompare(
            String(b.frontmatter[schema.id.dateField] ?? ""),
          ),
        )
      : [...docs].sort((a, b) => a.id - b.id);
  for (const d of sorted) {
    lines.push(`| ${cols.map((c) => cellValue(d, c, schema.id.pad)).join(" | ")} |`);
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 5: Run, confirm pass.** `cd ~/dev/lore && pnpm vitest run test/core/index-md.test.ts` → PASS.

- [ ] **Step 6: Commit.** `git add src/core/index-md.ts test/core/index-md.test.ts test/fixtures/decision.schema.yaml && git commit -m "column-driven renderIndex"`

---

## Task 5: Thread schema through the CLI

**Files:** Modify `src/cli/index.ts`, `test/cli/cli.test.ts`

- [ ] **Step 1: Update CLI test** — the existing test's schema fixture (written into the temp repo) must include an `index` block, and add a free-body `add` assertion. Edit `test/cli/cli.test.ts` `beforeEach` schema to:

```ts
writeFileSync(
  join(root, "docs/.lore/types/decision.schema.yaml"),
  `name: decision\ndir: decisions\nid: { strategy: sequential }\nbody: sections\nfrontmatter:\n  - { name: title, type: string, required: true }\n  - { name: date, type: date }\nsections: [Why this choice]\nindex:\n  - { header: "#", source: id }\n  - { header: Decision, source: title, link: true }\n`,
);
```

And add a second test:

```ts
it("add devlog (dated, free body) writes a dated file + INDEX", () => {
  writeFileSync(
    join(root, "docs/.lore/types/devlog.schema.yaml"),
    `name: devlog\ndir: devlog\nid: { strategy: dated }\nbody: free\nheading: Devlog\nfrontmatter:\n  - { name: title, type: string, required: true }\n  - { name: date, type: date, required: true }\nindex:\n  - { header: Date, source: date, format: date }\n  - { header: Entry, source: title, link: true }\n`,
  );
  mkdirSync(join(root, "docs/devlog"), { recursive: true });
  run(
    ["add", "devlog", "--title", "Day 5", "--field", "date=2026-02-21", "--body", "Did things."],
    join(root, "docs"),
  );
  const idx = readFileSync(join(root, "docs/devlog/INDEX.md"), "utf8");
  expect(idx).toContain("# Devlog");
  expect(idx).toContain("Day 5");
  expect(existsSync(join(root, "docs/devlog/2026-02-21-day-5.md"))).toBe(true);
});
```

- [ ] **Step 2: Run, confirm fail.** `cd ~/dev/lore && pnpm vitest run test/cli/cli.test.ts` → FAIL.

- [ ] **Step 3: Update `src/cli/index.ts`** — thread schema, add `--body`:

Replace `parseFlags` to also capture `--body`:

```ts
function parseFlags(args: string[]) {
  const fields: Record<string, string> = {};
  const sections: Record<string, string> = {};
  let title = "";
  let body = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--title") title = args[++i];
    else if (args[i] === "--body") body = args[++i];
    else if (args[i] === "--field") {
      const [k, ...v] = args[++i].split("=");
      fields[k] = v.join("=");
    } else if (args[i] === "--section") {
      const [k, ...v] = args[++i].split("=");
      sections[k] = v.join("=");
    }
  }
  return { title, fields, sections, body };
}
```

Replace `reindex` and the command bodies to pass `schema`:

```ts
function reindex(docsRoot: string, schema: DocTypeSchema) {
  const dir = dirFor(docsRoot, schema);
  writeFileSync(join(dir, "INDEX.md"), renderIndex(readDocs(dir, schema), schema));
}
```

In the switch: `readDocs(dir)` → `readDocs(dir, schema)` (list, search, validate). For `add`:

```ts
case "add": {
  const { title, fields, sections, body } = parseFlags(rest);
  const file = writeDoc(dir, schema, {
    frontmatter: { title, ...fields },
    title,
    sections,
    body: body || undefined,
  });
  reindex(cfg.docsRoot, schema);
  console.log(`created ${file}`);
  break;
}
```

Update the `renderIndex` import usage and ensure `import { renderIndex } from "../core/index-md.js";` and `readDocs`/`writeDoc` from store are present.

- [ ] **Step 4: Run full suite.** `cd ~/dev/lore && pnpm vitest run` → all PASS.

- [ ] **Step 5: Commit.** `git add src/cli/index.ts test/cli/cli.test.ts && git commit -m "thread schema through CLI; add --body for free-body types"`

---

## Task 6: Decision schema migration + regression

**Files:** Modify `/Users/suki/dev/cliphy/docs/.lore/types/decision.schema.yaml`, add `src/core/__golden__` check via test

- [ ] **Step 1: Update Cliphy's decision schema** to the explicit generalized form (must match the fixture from Task 4):

```yaml
name: decision
dir: decisions
heading: Decisions Log
id: { strategy: sequential, pad: 4 }
body: sections
frontmatter:
  - { name: title, type: string, required: true }
  - { name: date, type: date, required: true }
  - { name: category, type: string }
  - { name: revisit, type: boolean }
sections: [Why this choice, Options considered, Tradeoffs]
index:
  - { header: "#", source: id }
  - { header: Date, source: date, format: date }
  - { header: Decision, source: title, link: true }
  - { header: Category, source: category }
  - { header: "Revisit?", source: revisit, format: yesno }
```

- [ ] **Step 2: Regression — decisions INDEX unchanged.** Rebuild lore and reindex Cliphy decisions:

```bash
cd ~/dev/lore && pnpm build
cd /Users/suki/dev/cliphy/docs && node ~/dev/lore/dist/cli/index.js reindex decision
cd /Users/suki/dev/cliphy && git diff --stat docs/decisions/INDEX.md
```

Expected: **no diff** (or whitespace-only that prettier normalizes). If columns/format differ, fix `renderIndex` until the decisions INDEX matches what v1 produced. Do NOT commit cliphy here — report the diff to the controller.

- [ ] **Step 3: Commit (lore repo only).** No lore code change in this task unless Step 2 required a fix; if a fix was needed, commit it: `git add -A && git commit -m "fix renderIndex to preserve decisions INDEX format"`. Otherwise skip.

---

## Task 7: Devlog type + dogfood + TUI free-body

**Files:** Create `/Users/suki/dev/cliphy/docs/.lore/types/devlog.schema.yaml`; modify `src/tui/app.tsx`

- [ ] **Step 1: Create the devlog schema in Cliphy**

```yaml
name: devlog
dir: devlog
heading: Devlog
id: { strategy: dated }
body: free
frontmatter:
  - { name: title, type: string, required: true }
  - { name: date, type: date, required: true }
  - { name: day, type: number }
  - { name: phase, type: string }
index:
  - { header: Day, source: day }
  - { header: Date, source: date, format: date }
  - { header: Entry, source: title, link: true }
  - { header: Phase, source: phase }
```

- [ ] **Step 2: Dogfood validate + reindex against the real 21 entries**

```bash
cd /Users/suki/dev/cliphy/docs && node ~/dev/lore/dist/cli/index.js validate devlog; echo "exit=$?"
cd /Users/suki/dev/cliphy/docs && node ~/dev/lore/dist/cli/index.js reindex devlog
head -8 /Users/suki/dev/cliphy/docs/devlog/INDEX.md
```

Expected: `validate` → `valid` (all 21 have title+date). `reindex` writes a Day|Date|Entry|Phase table sorted by date. Report the result + any validation issues to the controller. Do NOT commit cliphy.

- [ ] **Step 3: TUI shows free-body docs** — update `src/tui/app.tsx` detail pane to render `body` when there are no sections:

Replace the detail-pane sections block with:

```tsx
{
  selected && Object.keys(selected.sections).length > 0
    ? Object.entries(selected.sections).map(([name, body]) => (
        <Box key={name} flexDirection="column" marginTop={1}>
          <Text underline>{name}</Text>
          <Text>{body}</Text>
        </Box>
      ))
    : selected && (
        <Box marginTop={1}>
          <Text>{selected.body}</Text>
        </Box>
      );
}
```

And `src/tui/run.ts`: `readDocs(join(cfg.docsRoot, schema.dir))` → `readDocs(join(cfg.docsRoot, schema.dir), schema)`.

- [ ] **Step 4: Build + full suite.** `cd ~/dev/lore && pnpm build && pnpm vitest run` → build clean, all tests pass.

- [ ] **Step 5: Commit (lore repo).** `git add src/tui && git commit -m "TUI renders free-body docs"`

---

## Self-Review

**Spec coverage:**

- Generalized schema (id/body/index) → Task 1 ✅
- Strategy-aware parseDoc + free body → Task 2 ✅
- dated id/sort + free writeDoc → Task 3 ✅
- Column-driven renderIndex → Task 4 ✅
- CLI threading + `--body` → Task 5 ✅
- Decisions back-compat (golden) → Task 6 ✅
- Devlog type + dogfood 21 → Task 7 ✅
- validateDoc unchanged (confirmed already tolerant) → no task needed ✅
- Existing day-NN files tolerated (dated reads date from frontmatter) → Tasks 2, 3 ✅
- Out of scope (roadmap/providers, web) → not in plan ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code. ✅

**Type consistency:** `DocTypeSchema` (id/body/index), `IndexColumn`, `Doc.body` defined in Task 1; `parseDoc(file, raw, strategy)` (Task 2) consumed by `readDocs(dir, schema)` (Task 3); `renderIndex(docs, schema)` (Task 4) called by CLI reindex (Task 5) and tests (Task 4) and TUI is read-only; `writeDoc(dir, schema, input)` (Task 3) called by CLI add (Task 5). `serializeFreeDoc` (Task 2) used by `writeDoc` free path (Task 3). All consistent. ✅

**Risk note:** Task 6 (decisions INDEX regression) is the highest-risk step — if the generalized column renderer changes the decisions INDEX even cosmetically, fix `renderIndex` before proceeding so v1 output is preserved.
