---
title: "Atlas — Slice 3: document creation + editing — Implementation Plan"
date: 2026-06-10
---

# Atlas — Slice 3: document creation + editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Create and edit documents of any type from Atlas — schema-driven field inputs (text/date/checkbox/number/enum-select), section textareas or a free-body textarea, written through `@lore/core` with the INDEX kept correct.

**Architecture:** A `docs-write.ts` lib (createDoc/updateDoc/reindexType, TDD'd against temp dirs) + a schema-driven `DocForm` client component shared by `/new` and `/edit` pages + thin server actions. Editing preserves the filename (no renumber/rename on title change — v1 decision). Body editor is a markdown `<textarea>` — porting tana-roam's Lexical (block-outliner-shaped) is deferred polish, not this slice.

**Tech Stack:** as Slices 0–2. Repo: `~/dev/atlas`.

---

## Task 1: write lib (`docs-write.ts`)

**Files:** `src/lib/docs-write.ts`, `test/docs-write.test.ts`. Work from `~/dev/atlas`.

- [ ] **Step 1: Failing tests.** Create `test/docs-write.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docTypeSchema } from "@lore/core";
import { createDoc, updateDoc, coerceFields } from "../src/lib/docs-write";

const seqSchema = docTypeSchema.parse({
  name: "decision",
  dir: "decisions",
  frontmatter: [
    { name: "title", type: "string", required: true },
    { name: "date", type: "date" },
    { name: "revisit", type: "boolean" },
    { name: "weight", type: "number" },
  ],
  sections: ["Why", "Tradeoffs"],
  index: [
    { header: "#", source: "id" },
    { header: "Decision", source: "title", link: true },
  ],
});
const freeSchema = docTypeSchema.parse({
  name: "devlog",
  dir: "devlog",
  id: { strategy: "dated" },
  body: "free",
  frontmatter: [
    { name: "title", type: "string", required: true },
    { name: "date", type: "date", required: true },
  ],
  index: [{ header: "Entry", source: "title", link: true }],
});

let docsRoot: string;
beforeEach(() => {
  docsRoot = join(mkdtempSync(join(tmpdir(), "atlas-dw-")), "docs");
  mkdirSync(join(docsRoot, "decisions"), { recursive: true });
  mkdirSync(join(docsRoot, "devlog"), { recursive: true });
});

describe("coerceFields", () => {
  it("coerces number/boolean, drops empty strings", () => {
    const out = coerceFields(seqSchema, { title: "X", weight: "3", revisit: "on", date: "" });
    expect(out).toEqual({ title: "X", weight: 3, revisit: true });
  });
});

describe("createDoc", () => {
  it("writes a sectioned doc and the INDEX", () => {
    const file = createDoc(docsRoot, seqSchema, {
      fields: { title: "Use X", date: "2026-06-10" },
      sections: { Why: "because", Tradeoffs: "" },
    });
    expect(file).toBe("0001-use-x.md");
    const text = readFileSync(join(docsRoot, "decisions", file), "utf8");
    expect(text).toContain("## Why");
    expect(text).not.toContain("## Tradeoffs"); // empty section omitted
    expect(readFileSync(join(docsRoot, "decisions/INDEX.md"), "utf8")).toContain("Use X");
  });
  it("writes a free-body dated doc", () => {
    const file = createDoc(docsRoot, freeSchema, {
      fields: { title: "Day 1", date: "2026-06-10" },
      sections: {},
      body: "# Day 1\n\nDid things.\n",
    });
    expect(file).toBe("2026-06-10-day-1.md");
    expect(readFileSync(join(docsRoot, "devlog", file), "utf8")).toContain("Did things.");
  });
  it("requires a title", () => {
    expect(() => createDoc(docsRoot, seqSchema, { fields: {}, sections: {} })).toThrow(/title/);
  });
});

describe("updateDoc", () => {
  it("rewrites fields + sections under the SAME filename even if title changed", () => {
    const file = createDoc(docsRoot, seqSchema, {
      fields: { title: "Old title" },
      sections: { Why: "v1" },
    });
    const updated = updateDoc(docsRoot, seqSchema, file.replace(/\.md$/, ""), {
      fields: { title: "New title", revisit: "on" },
      sections: { Why: "v2", Tradeoffs: "added" },
    });
    expect(updated).toBe(file); // filename preserved
    const text = readFileSync(join(docsRoot, "decisions", file), "utf8");
    expect(text).toContain("New title");
    expect(text).toContain("v2");
    expect(text).toContain("## Tradeoffs");
    expect(text).toContain("revisit: true");
    expect(readFileSync(join(docsRoot, "decisions/INDEX.md"), "utf8")).toContain("New title");
  });
  it("throws on unknown doc", () => {
    expect(() =>
      updateDoc(docsRoot, seqSchema, "0099-nope", { fields: { title: "x" }, sections: {} }),
    ).toThrow(/not found/);
  });
});
```

Run: `pnpm vitest run test/docs-write.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement `src/lib/docs-write.ts`.**

```ts
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  readDocs,
  writeDoc,
  renderIndex,
  serializeDoc,
  serializeFreeDoc,
  type DocTypeSchema,
} from "@lore/core";

export interface DocInput {
  fields: Record<string, string>;
  sections: Record<string, string>;
  body?: string;
}

export function coerceFields(
  schema: DocTypeSchema,
  fields: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema.frontmatter) {
    const raw = fields[f.name];
    if (f.type === "boolean") {
      if (raw === "on" || raw === "true") out[f.name] = true;
      continue; // unchecked checkboxes are absent → omit (false by absence)
    }
    if (raw === undefined || raw === "") continue;
    if (f.type === "number") {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new Error(`field "${f.name}" must be a number`);
      out[f.name] = n;
    } else {
      out[f.name] = raw;
    }
  }
  return out;
}

export function reindexType(docsRoot: string, schema: DocTypeSchema): void {
  const dir = join(docsRoot, schema.dir);
  writeFileSync(join(dir, "INDEX.md"), renderIndex(readDocs(dir, schema), schema));
}

export function createDoc(docsRoot: string, schema: DocTypeSchema, input: DocInput): string {
  const frontmatter = coerceFields(schema, input.fields);
  const title = String(frontmatter.title ?? "");
  if (!title) throw new Error("title is required");
  const file = writeDoc(join(docsRoot, schema.dir), schema, {
    frontmatter,
    title,
    sections: input.sections,
    body: input.body,
  });
  reindexType(docsRoot, schema);
  return file;
}

export function updateDoc(
  docsRoot: string,
  schema: DocTypeSchema,
  fileBase: string,
  input: DocInput,
): string {
  const dir = join(docsRoot, schema.dir);
  const file = `${fileBase}.md`;
  const path = join(dir, file);
  if (!existsSync(path)) throw new Error(`doc not found: ${file}`);
  const frontmatter = coerceFields(schema, input.fields);
  const title = String(frontmatter.title ?? "");
  if (!title) throw new Error("title is required");
  const content =
    schema.body === "free"
      ? serializeFreeDoc(frontmatter, input.body ?? "")
      : serializeDoc(frontmatter, title, input.sections, schema.sections);
  writeFileSync(path, content);
  reindexType(docsRoot, schema);
  return file;
}
```

Run: `pnpm vitest run` → all green (7 existing + 6 new = 13).

- [ ] **Step 3: Commit.** `git add -A && git commit -m "atlas: doc write lib (createDoc/updateDoc) over @lore/core"`

---

## Task 2: DocForm + new/edit pages + actions

**Files:** `src/components/DocForm.tsx`, `src/lib/actions.ts` (extend), `src/app/p/[project]/[type]/new/page.tsx`, `src/app/p/[project]/[type]/[file]/edit/page.tsx`; modify type index page (+ "New <type>" link) and record page (+ "Edit" link). Work from `~/dev/atlas`.

Route note: static `new` beats `[file]`; static `edit` is a child segment of `[file]` so no conflict. A doc literally named `new.md` would be shadowed — acceptable (lore slugs come from titles; flag only).

- [ ] **Step 1: Extend `src/lib/actions.ts`** (append; keep existing actions):

```ts
import { createDoc, updateDoc, type DocInput } from "./docs-write";

function docInputFromForm(formData: FormData): DocInput {
  const fields: Record<string, string> = {};
  const sections: Record<string, string> = {};
  let body: string | undefined;
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (key.startsWith("field_")) fields[key.slice(6)] = value;
    else if (key.startsWith("section_")) sections[key.slice(8)] = value;
    else if (key === "body") body = value;
  }
  return { fields, sections, body };
}

export async function createDocAction(
  projectName: string,
  typeName: string,
  formData: FormData,
): Promise<void> {
  const project = getProject(projectName);
  const schema = project.types[typeName];
  if (!schema) throw new Error(`unknown type: ${typeName}`);
  const file = createDoc(project.docsRoot, schema, docInputFromForm(formData));
  redirect(`/p/${projectName}/${typeName}/${file.replace(/\.md$/, "")}`);
}

export async function updateDocAction(
  projectName: string,
  typeName: string,
  fileBase: string,
  formData: FormData,
): Promise<void> {
  const project = getProject(projectName);
  const schema = project.types[typeName];
  if (!schema) throw new Error(`unknown type: ${typeName}`);
  updateDoc(project.docsRoot, schema, fileBase, docInputFromForm(formData));
  redirect(`/p/${projectName}/${typeName}/${fileBase}`);
}
```

- [ ] **Step 2: `src/components/DocForm.tsx`** (client; schema-driven inputs; works for create and edit):

```tsx
"use client";

type Field = {
  name: string;
  type: "string" | "date" | "boolean" | "number" | "enum";
  required: boolean;
  values?: string[];
};

export interface DocFormProps {
  action: (formData: FormData) => Promise<void>;
  fields: Field[];
  sections: string[]; // schema sections ([] for free body)
  freeBody: boolean;
  initial?: { fields: Record<string, string>; sections: Record<string, string>; body?: string };
  submitLabel: string;
}

export function DocForm({
  action,
  fields,
  sections,
  freeBody,
  initial,
  submitLabel,
}: DocFormProps) {
  const input = "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200";
  const area = `${input} w-full min-h-32 font-mono leading-relaxed`;
  return (
    <form action={action} className="max-w-2xl space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <label key={f.name} className="space-y-1 text-sm text-zinc-400">
            {f.name}
            {f.required ? " *" : ""}
            {f.type === "boolean" ? (
              <input
                type="checkbox"
                name={`field_${f.name}`}
                defaultChecked={initial?.fields[f.name] === "true"}
                className="ml-2 align-middle"
              />
            ) : f.type === "enum" ? (
              <select
                name={`field_${f.name}`}
                defaultValue={initial?.fields[f.name] ?? ""}
                className={`${input} w-full`}
              >
                <option value="">—</option>
                {(f.values ?? []).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                step={f.type === "number" ? "any" : undefined}
                name={`field_${f.name}`}
                required={f.required}
                defaultValue={initial?.fields[f.name] ?? ""}
                className={`${input} w-full`}
              />
            )}
          </label>
        ))}
      </div>

      {freeBody ? (
        <label className="block space-y-1 text-sm text-zinc-400">
          Body (markdown)
          <textarea name="body" defaultValue={initial?.body ?? ""} className={area} rows={14} />
        </label>
      ) : (
        sections.map((s) => (
          <label key={s} className="block space-y-1 text-sm text-zinc-400">
            {s}
            <textarea
              name={`section_${s}`}
              defaultValue={initial?.sections[s] ?? ""}
              className={area}
              rows={5}
            />
          </label>
        ))
      )}

      <button
        type="submit"
        className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white"
      >
        {submitLabel}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: New-doc page `src/app/p/[project]/[type]/new/page.tsx`.**

```tsx
import { DocForm } from "../../../../../components/DocForm";
import { createDocAction } from "../../../../../lib/actions";
import { getProject } from "../../../../../lib/projects";

export const dynamic = "force-dynamic";

export default async function NewDocPage({
  params,
}: {
  params: Promise<{ project: string; type: string }>;
}) {
  const { project, type } = await params;
  const schema = getProject(project).types[type];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-100">New {schema.name}</h1>
      <DocForm
        action={createDocAction.bind(null, project, type)}
        fields={schema.frontmatter}
        sections={schema.sections}
        freeBody={schema.body === "free"}
        submitLabel={`Create ${schema.name}`}
      />
    </div>
  );
}
```

- [ ] **Step 4: Edit page `src/app/p/[project]/[type]/[file]/edit/page.tsx`.** Initial values: stringify frontmatter (Dates → YYYY-MM-DD, booleans → "true"/"false"); sections from `doc.sections`; body from `doc.body`.

```tsx
import { DocForm } from "../../../../../../components/DocForm";
import { updateDocAction } from "../../../../../../lib/actions";
import { getProject, getDoc } from "../../../../../../lib/projects";

export const dynamic = "force-dynamic";

function initialFieldValues(frontmatter: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(frontmatter)) {
    if (v == null) continue;
    out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  }
  return out;
}

export default async function EditDocPage({
  params,
}: {
  params: Promise<{ project: string; type: string; file: string }>;
}) {
  const { project, type, file } = await params;
  const schema = getProject(project).types[type];
  const doc = getDoc(project, type, file);
  if (!doc) return <div className="text-zinc-400">Not found.</div>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-100">
        Edit {String(doc.frontmatter.title ?? doc.slug)}
      </h1>
      <DocForm
        action={updateDocAction.bind(null, project, type, file)}
        fields={schema.frontmatter}
        sections={schema.sections}
        freeBody={schema.body === "free"}
        initial={{
          fields: initialFieldValues(doc.frontmatter),
          sections: doc.sections,
          body: doc.body,
        }}
        submitLabel="Save"
      />
    </div>
  );
}
```

- [ ] **Step 5: Wire links.**
  - Type index page: next to the heading add `<Link href={`/p/${project}/${type}/new`} ...>+ New {schema.name}</Link>`.
  - Record page (`[file]/page.tsx`): in the header add `<Link href={`/p/${project}/${type}/${file}/edit`} className="text-sm text-zinc-500 hover:text-zinc-200">Edit</Link>`.

- [ ] **Step 6: Verify.**

```bash
cd ~/dev/atlas && pnpm vitest run && pnpm build
lsof -ti:4123 | xargs kill -9 2>/dev/null; (pnpm dev --port 4123 > /tmp/atlas-dev.log 2>&1 &) && sleep 6
curl -s localhost:4123/p/cliphy/decision/new | grep -o "Create decision" | head -1
curl -s localhost:4123/p/cliphy/decision/0014-switch-from-crxjs-to-wxt/edit | grep -o "Edit Switch" | head -1
curl -s localhost:4123/p/cliphy/devlog/2026-06-07-proxy-rotation-innertube-titles-sentry-tracing-migration-runner/edit | grep -o "Body (markdown)" | head -1
```

All three greps must hit. Leave the server running.

- [ ] **Step 7: Commit.** `git add -A && git commit -m "atlas: doc create/edit — schema-driven DocForm + new/edit pages"`

---

## Task 3 (controller-run): browser QA against a throwaway project

Same pattern as Slice 2: temp project in config → create a doc via the UI form → edit it (change a field + a section) → verify the file + INDEX on disk reflect both writes and the filename didn't change → lore CLI `validate` passes → revert config + cleanup. Run by the controller, not a subagent.

---

## Self-Review

**Spec coverage (Slice 3):** create doc with schema-driven inputs per field type → DocForm + new page; edit body with markdown editor → textarea (Lexical port explicitly deferred, stated in header); writes through core, INDEX correct → docs-write lib + reindexType; works for both body modes → sectioned + free covered in lib tests and pages. ✅
**Placeholders:** none; complete code throughout. ✅
**Type consistency:** `DocInput`/`coerceFields`/`createDoc`/`updateDoc` (Task 1) consumed by actions (Task 2); `DocForm` props match both call sites; `getDoc`/`getProject` exist from Slice 1; `serializeDoc`/`serializeFreeDoc`/`writeDoc`/`renderIndex`/`readDocs` all exported by `@lore/core` since lore v2 + barrel. ✅
**Decisions flagged:** filename preserved on edit (no renumber/rename); unchecked boolean = omitted from frontmatter (absence = false); empty fields omitted; textarea not Lexical.
