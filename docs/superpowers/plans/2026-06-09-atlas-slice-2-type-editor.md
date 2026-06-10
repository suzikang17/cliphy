# Atlas — Slice 2: type creation/editing UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the user create a new doc type (name + custom fields) and add fields to existing types from Atlas's UI — writing `docs/.lore/types/<name>.schema.yaml` in the target repo. The Tana-style "supertag" experience, file-backed.

**Architecture:** `@lore/core` gains `serializeSchema` (schema → YAML). Atlas gains a write lib (`types-write.ts`, tested against temp dirs) + thin server actions + two UI surfaces (a New Type form page; an inline Add Field form on the type index page). Pages stay server components; forms are small client components posting to server actions.

**Tech Stack:** as Slice 0–1. Repos: `~/dev/lore` (workspace), `~/dev/atlas`.

---

## Task 1: `@lore/core` — serializeSchema

**Files:** `~/dev/lore/packages/core/src/schema.ts`, `packages/core/src/index.ts` (no change — schema.ts already exported), `packages/core/test/core/schema.test.ts`. Work from `~/dev/lore`.

- [ ] **Step 1: Failing round-trip test.** Append to `packages/core/test/core/schema.test.ts`:

```ts
import { serializeSchema } from "../../src/schema.js";

describe("serializeSchema", () => {
  it("round-trips: loadSchema(serializeSchema(s)) equals s", () => {
    const s = loadSchema(
      `name: provider\ndir: providers\nheading: Providers\nid: { strategy: dated }\nbody: free\nfrontmatter:\n  - { name: title, type: string, required: true }\n  - { name: monthly_cost, type: number }\nindex:\n  - { header: Provider, source: title, link: true }\n`,
    );
    const yaml = serializeSchema(s);
    expect(loadSchema(yaml)).toEqual(s);
  });
});
```

Run: `pnpm --filter @lore/core test` → FAIL (no export).

- [ ] **Step 2: Implement.** In `packages/core/src/schema.ts` add:

```ts
import { stringify as stringifyYaml } from "yaml";

export function serializeSchema(schema: DocTypeSchema): string {
  return stringifyYaml(schema);
}
```

(Adjust the existing `parse as parseYaml` import line to also import `stringify`.) Zod defaults are materialized on load, so dumping the full parsed object round-trips exactly.

- [ ] **Step 3: Green + build + commit.**

```bash
cd ~/dev/lore && pnpm -r test && pnpm -r build
git add -A && git commit -m "core: serializeSchema (schema -> yaml)"
```

---

## Task 2: Atlas write lib (`types-write.ts`)

**Files:** `~/dev/atlas/src/lib/types-write.ts`, `test/types-write.test.ts`. Work from `~/dev/atlas`. First refresh the dep so Atlas sees the new core build: `pnpm install` (file: deps re-link) — verify `serializeSchema` is importable.

- [ ] **Step 1: Failing tests.** Create `test/types-write.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createType, addField } from "../src/lib/types-write";

let docsRoot: string;
beforeEach(() => {
  docsRoot = join(mkdtempSync(join(tmpdir(), "atlas-tw-")), "docs");
  mkdirSync(join(docsRoot, ".lore/types"), { recursive: true });
});

describe("createType", () => {
  it("writes <name>.schema.yaml with auto index and creates the docs dir", () => {
    createType(docsRoot, {
      name: "recipe",
      dir: "recipes",
      heading: "Recipes",
      idStrategy: "slug" in {} ? "sequential" : "sequential", // sequential
      body: "sections",
      sections: ["Ingredients", "Steps"],
      fields: [
        { name: "title", type: "string", required: true },
        { name: "date", type: "date", required: false },
        { name: "vegetarian", type: "boolean", required: false },
      ],
    });
    const file = join(docsRoot, ".lore/types/recipe.schema.yaml");
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("name: recipe");
    expect(text).toContain("vegetarian");
    // auto index: title linked, date formatted, boolean yesno
    expect(text).toContain("link: true");
    expect(text).toContain("format: date");
    expect(text).toContain("format: yesno");
    expect(existsSync(join(docsRoot, "recipes"))).toBe(true);
  });
  it("rejects duplicate and reserved names", () => {
    writeFileSync(
      join(docsRoot, ".lore/types/recipe.schema.yaml"),
      "name: recipe\ndir: recipes\nfrontmatter: []\n",
    );
    expect(() =>
      createType(docsRoot, {
        name: "recipe",
        dir: "recipes",
        body: "sections",
        idStrategy: "sequential",
        fields: [],
        sections: [],
      }),
    ).toThrow(/exists/);
    expect(() =>
      createType(docsRoot, {
        name: "new",
        dir: "news",
        body: "sections",
        idStrategy: "sequential",
        fields: [],
        sections: [],
      }),
    ).toThrow(/reserved/);
  });
});

describe("addField", () => {
  it("appends a field and an index column to an existing schema", () => {
    createType(docsRoot, {
      name: "recipe",
      dir: "recipes",
      body: "sections",
      idStrategy: "sequential",
      sections: [],
      fields: [{ name: "title", type: "string", required: true }],
    });
    addField(docsRoot, "recipe", { name: "rating", type: "number", required: false });
    const text = readFileSync(join(docsRoot, ".lore/types/recipe.schema.yaml"), "utf8");
    expect(text).toContain("rating");
    expect(text.match(/header: Rating/)).toBeTruthy();
  });
});
```

Run: `pnpm vitest run test/types-write.test.ts` → FAIL.

- [ ] **Step 2: Implement `src/lib/types-write.ts`.**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  docTypeSchema,
  loadSchema,
  serializeSchema,
  type DocTypeField,
  type DocTypeSchema,
  type IndexColumn,
} from "@lore/core";

const RESERVED = new Set(["new", "types", "edit"]);

export interface NewTypeInput {
  name: string;
  dir: string;
  heading?: string;
  idStrategy: "sequential" | "dated";
  body: "sections" | "free";
  sections: string[];
  fields: { name: string; type: DocTypeField["type"]; required: boolean }[];
}

function schemaPath(docsRoot: string, name: string): string {
  return join(docsRoot, ".lore", "types", `${name}.schema.yaml`);
}

function titleCase(s: string): string {
  return s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function autoIndex(fields: NewTypeInput["fields"], idStrategy: string): IndexColumn[] {
  const cols: IndexColumn[] = [];
  if (idStrategy === "sequential")
    cols.push({ header: "#", source: "id", link: false, format: undefined });
  for (const f of fields) {
    const col: IndexColumn = {
      header: f.name === "title" ? "Title" : titleCase(f.name),
      source: f.name,
      link: f.name === "title",
      format: f.type === "date" ? "date" : f.type === "boolean" ? "yesno" : undefined,
    };
    cols.push(col);
  }
  return cols;
}

export function createType(docsRoot: string, input: NewTypeInput): DocTypeSchema {
  const name = input.name.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error(`invalid type name: ${name}`);
  if (RESERVED.has(name)) throw new Error(`"${name}" is a reserved name`);
  const file = schemaPath(docsRoot, name);
  if (existsSync(file)) throw new Error(`type "${name}" already exists`);

  const schema = docTypeSchema.parse({
    name,
    dir: input.dir.trim(),
    heading: input.heading?.trim() || undefined,
    id: { strategy: input.idStrategy },
    body: input.body,
    sections: input.body === "sections" ? input.sections.filter((s) => s.trim()) : [],
    frontmatter: input.fields.map((f) => ({
      name: f.name.trim(),
      type: f.type,
      required: f.required,
    })),
    index: autoIndex(input.fields, input.idStrategy),
  });
  writeFileSync(file, serializeSchema(schema));
  mkdirSync(join(docsRoot, schema.dir), { recursive: true });
  return schema;
}

export function addField(
  docsRoot: string,
  typeName: string,
  field: { name: string; type: DocTypeField["type"]; required: boolean },
): DocTypeSchema {
  const file = schemaPath(docsRoot, typeName);
  if (!existsSync(file)) throw new Error(`type "${typeName}" not found`);
  const schema = loadSchema(readFileSync(file, "utf8"));
  if (schema.frontmatter.some((f) => f.name === field.name))
    throw new Error(`field "${field.name}" already exists`);
  schema.frontmatter.push({
    name: field.name.trim(),
    type: field.type,
    required: field.required,
    values: undefined,
  });
  schema.index.push({
    header: titleCase(field.name),
    source: field.name,
    link: false,
    format: field.type === "date" ? "date" : field.type === "boolean" ? "yesno" : undefined,
  });
  writeFileSync(file, serializeSchema(schema));
  return schema;
}
```

Note: the test's `idStrategy` line contains a no-op ternary — replace it with plain `idStrategy: "sequential"` when writing the test (it must read cleanly).

Run: `pnpm vitest run` → all tests PASS (8 total: 4 projects + 4 new).

- [ ] **Step 3: Commit.** `git add -A && git commit -m "atlas: type write lib (createType/addField) over @lore/core"`

---

## Task 3: UI — New Type page + Add Field form

**Files:** `src/lib/actions.ts`, `src/components/NewTypeForm.tsx`, `src/components/AddFieldForm.tsx`, `src/app/p/[project]/types/new/page.tsx`; modify `src/app/p/[project]/page.tsx`, `src/app/p/[project]/[type]/page.tsx`, `src/app/layout.tsx`. Work from `~/dev/atlas`.

Route note: `/p/[project]/types/new` (static segment `types`) takes precedence over `[type]` — and `createType` rejects reserved names, so no collision.

- [ ] **Step 1: Server actions `src/lib/actions.ts`.**

```ts
"use server";

import { redirect } from "next/navigation";
import { getProject } from "./projects";
import { createType, addField, type NewTypeInput } from "./types-write";

export async function createTypeAction(projectName: string, formData: FormData): Promise<void> {
  const project = getProject(projectName);
  const fields = JSON.parse(String(formData.get("fields") ?? "[]")) as NewTypeInput["fields"];
  const sections = String(formData.get("sections") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const schema = createType(project.docsRoot, {
    name: String(formData.get("name") ?? ""),
    dir: String(formData.get("dir") ?? ""),
    heading: String(formData.get("heading") ?? "") || undefined,
    idStrategy: (formData.get("idStrategy") as "sequential" | "dated") ?? "sequential",
    body: (formData.get("body") as "sections" | "free") ?? "sections",
    sections,
    fields,
  });
  redirect(`/p/${projectName}/${schema.name}`);
}

export async function addFieldAction(
  projectName: string,
  typeName: string,
  formData: FormData,
): Promise<void> {
  const project = getProject(projectName);
  addField(project.docsRoot, typeName, {
    name: String(formData.get("name") ?? ""),
    type: (formData.get("type") as "string" | "date" | "boolean" | "number" | "enum") ?? "string",
    required: formData.get("required") === "on",
  });
  redirect(`/p/${projectName}/${typeName}`);
}
```

- [ ] **Step 2: `src/components/NewTypeForm.tsx`** (client component — dynamic field rows serialized into a hidden input):

```tsx
"use client";

import { useState } from "react";

const FIELD_TYPES = ["string", "date", "boolean", "number", "enum"] as const;
type Row = { name: string; type: (typeof FIELD_TYPES)[number]; required: boolean };

export function NewTypeForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [rows, setRows] = useState<Row[]>([{ name: "title", type: "string", required: true }]);
  const [body, setBody] = useState<"sections" | "free">("sections");
  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const input = "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200";
  return (
    <form action={action} className="max-w-xl space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm text-zinc-400">
          Name (singular){" "}
          <input name="name" required placeholder="recipe" className={`${input} w-full`} />
        </label>
        <label className="space-y-1 text-sm text-zinc-400">
          Directory{" "}
          <input name="dir" required placeholder="recipes" className={`${input} w-full`} />
        </label>
        <label className="space-y-1 text-sm text-zinc-400">
          Heading <input name="heading" placeholder="Recipes" className={`${input} w-full`} />
        </label>
        <label className="space-y-1 text-sm text-zinc-400">
          ID strategy
          <select name="idStrategy" className={`${input} w-full`}>
            <option value="sequential">sequential (0001, 0002…)</option>
            <option value="dated">dated (YYYY-MM-DD)</option>
          </select>
        </label>
        <label className="space-y-1 text-sm text-zinc-400">
          Body
          <select
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value as "sections" | "free")}
            className={`${input} w-full`}
          >
            <option value="sections">fixed sections</option>
            <option value="free">freeform</option>
          </select>
        </label>
        {body === "sections" && (
          <label className="space-y-1 text-sm text-zinc-400">
            Sections (comma-sep){" "}
            <input name="sections" placeholder="Why, Notes" className={`${input} w-full`} />
          </label>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium text-zinc-300">Fields</div>
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={r.name}
              onChange={(e) => set(i, { name: e.target.value })}
              placeholder="field name"
              className={input}
            />
            <select
              value={r.type}
              onChange={(e) => set(i, { type: e.target.value as Row["type"] })}
              className={input}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={r.required}
                onChange={(e) => set(i, { required: e.target.checked })}
              />{" "}
              required
            </label>
            {i > 0 && (
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="text-xs text-zinc-500 hover:text-red-400"
              >
                remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, { name: "", type: "string", required: false }])}
          className="text-sm text-zinc-400 hover:text-white"
        >
          + Add field
        </button>
      </div>

      <input
        type="hidden"
        name="fields"
        value={JSON.stringify(rows.filter((r) => r.name.trim()))}
      />
      <button
        type="submit"
        className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white"
      >
        Create type
      </button>
    </form>
  );
}
```

- [ ] **Step 3: `src/components/AddFieldForm.tsx`:**

```tsx
"use client";

export function AddFieldForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  const input = "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200";
  return (
    <form action={action} className="flex items-center gap-2">
      <input name="name" required placeholder="new field" className={input} />
      <select name="type" className={input}>
        {["string", "date", "boolean", "number", "enum"].map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-zinc-400">
        <input type="checkbox" name="required" /> required
      </label>
      <button
        type="submit"
        className="rounded border border-zinc-700 px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
      >
        Add field
      </button>
    </form>
  );
}
```

- [ ] **Step 4: New Type page `src/app/p/[project]/types/new/page.tsx`:**

```tsx
import { NewTypeForm } from "../../../../../components/NewTypeForm";
import { createTypeAction } from "../../../../../lib/actions";

export const dynamic = "force-dynamic";

export default async function NewTypePage({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  const action = createTypeAction.bind(null, project);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-100">New type in {project}</h1>
      <NewTypeForm action={action} />
    </div>
  );
}
```

- [ ] **Step 5: Wire entry points.**
  - Project page (`/p/[project]/page.tsx`): add below the list — `<Link href={`/p/${p.name}/types/new`} className="text-sm text-zinc-500 hover:text-zinc-200">+ New type</Link>`.
  - Type index page (`/p/[project]/[type]/page.tsx`): import `AddFieldForm` + `addFieldAction`; at the bottom render `<div className="pt-4 border-t border-zinc-900"><AddFieldForm action={addFieldAction.bind(null, project, type)} /></div>`.
  - Sidebar (`layout.tsx`): under each project's type list add a small `+ new type` link to `/p/${p.name}/types/new`.

- [ ] **Step 6: Verify.**

```bash
cd ~/dev/atlas && pnpm vitest run && pnpm build
pnpm dev --port 4123 & sleep 5
curl -s localhost:4123/p/cliphy/types/new | grep -o "Create type" | head -1     # form renders
curl -s localhost:4123/p/cliphy/decision | grep -o "Add field" | head -1        # inline form present
kill %1
```

Both greps must hit. (Actually creating a type via the browser is the human dogfood — leave to the user.)

- [ ] **Step 7: Commit.** `git add -A && git commit -m "atlas: type editor — New Type page + Add Field form writing schema yaml"`

---

## Self-Review

**Spec coverage (Slice 2):** create type w/ custom fields → Tasks 2–3; add field to existing → Tasks 2–3; writes `<type>.yaml` in-repo → `types-write.ts`; field types string/date/boolean/number/enum → forms + lib; auto index columns → `autoIndex`; reserved/duplicate guards → `createType`. Editing/removing/renaming fields beyond add = out of scope per spec (warn-later). ✅
**Placeholders:** one flagged self-correction (the no-op ternary in Task 2's test — instruction given to write it as plain `"sequential"`). Otherwise complete code. ✅
**Type consistency:** `serializeSchema` (Task 1) used by Task 2; `NewTypeInput`/`createType`/`addField` (Task 2) used by Task 3 actions; `IndexColumn`/`DocTypeField` come from `@lore/core` (exist since lore v2). `docTypeSchema` zod export exists in core types.ts. ✅
**Risk:** Next server actions + `.bind` for extra args — standard pattern; forms are client components so binding happens server-side in the page. Flagged route precedence (`types` static beats `[type]`).
