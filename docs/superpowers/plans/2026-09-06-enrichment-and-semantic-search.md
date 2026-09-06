# Enrichment Improvements & Semantic Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make auto-tagging reuse the user's existing tag vocabulary, and turn the stored-but-unused clip embeddings into related-clips + semantic search.

**Architecture:** A pgvector `match_clips` SQL function over the existing HNSW cosine index powers a `related.ts` service (`GET /api/clips/:id/related`) and a `search.ts` service that upgrades `/api/summaries/search` to semantic (ILIKE fallback). `embed-clip` passes the user's distinct tags into `enrichClip` so tags stay consistent. Mobile gains a Related section and an inbox search field.

**Tech Stack:** Hono + Supabase (pgvector) + Inngest, Voyage `voyage-3.5` embeddings, Vitest v4 (run from repo root: `pnpm vitest run <path>`), React Native + Expo.

## Global Constraints

- Server relative imports use the `.js` extension (NodeNext ESM). Mobile imports are extensionless.
- DB table is `clips`; `toClip`/`toSummary` (alias) in `apps/server/src/lib/mappers.ts` map rows. `resolveClipImage` (exported from `routes/clips.js`) signs image clips on read.
- Similarity RPC: `supabase.rpc("match_clips", { query_embedding, match_user_id, exclude_id, match_count })` returns `{ id, similarity }[]`.
- Embeddings: `generateEmbedding(text)` from `services/embedding.js` → `number[]` (1024-dim, Voyage `voyage-3.5`).
- Tests run from repo root: `pnpm vitest run <path>`. Suites tag Allure in `beforeEach`: `layer("unit"); epic(...); feature(...);` from `allure-js-commons`.
- Migrations in `apps/server/supabase/migrations/`, applied via `pnpm --filter server migrate` (`DATABASE_URL` in `apps/server/.env.local`, deleted after).
- The vision/tiling tests need `LD_LIBRARY_PATH=node_modules/@img/sharp-libvips-linux-x64/lib` in this sandbox (sharp) — unrelated to this subproject but required when running the full server suite locally.
- Commit messages: imperative mood, end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

**Server (`apps/server/src/`)**

- `supabase/migrations/026_match_clips.sql` — index recreate + `match_clips` (new).
- `services/enrich.ts` — `existingTags` param + prompt (modify).
- `functions/embed-clip.ts` — fetch + pass existing tags (modify).
- `services/related.ts` — `findRelatedClips` (new).
- `services/search.ts` — `semanticSearch` (new).
- `routes/clips.ts` — `GET /:id/related` (modify).
- `routes/summaries.ts` — semantic-first search with ILIKE fallback (modify).

**Mobile (`apps/mobile/`)**

- `lib/api.ts` — `getRelatedClips`, `searchClips` (modify).
- `app/summary/[id].tsx` — Related section (modify).
- `app/(tabs)/index.tsx` — inbox search field (modify).

---

### Task 1: Migration — `match_clips` similarity function

**Files:**

- Create: `apps/server/supabase/migrations/026_match_clips.sql`

**Interfaces:**

- Produces: SQL function `match_clips(query_embedding vector(1024), match_user_id uuid, exclude_id uuid, match_count int) returns table(id uuid, similarity float)`.

- [ ] **Step 1: Write the migration**

Create `apps/server/supabase/migrations/026_match_clips.sql`:

```sql
-- apps/server/supabase/migrations/026_match_clips.sql
-- Semantic search + related clips: a pgvector similarity function over the
-- existing 1024-dim cosine embedding column.

-- Ensure the HNSW cosine index exists on the current `clips` table (migration
-- 022 created it against the pre-rename `summaries` name).
create index if not exists clips_embedding_idx
  on public.clips using hnsw (embedding vector_cosine_ops);

create or replace function match_clips(
  query_embedding vector(1024),
  match_user_id uuid,
  exclude_id uuid,
  match_count int
)
returns table (id uuid, similarity float)
language sql stable
as $$
  select c.id, 1 - (c.embedding <=> query_embedding) as similarity
  from public.clips c
  where c.user_id = match_user_id
    and c.deleted_at is null
    and c.status = 'completed'
    and c.embedding is not null
    and c.id <> exclude_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
```

- [ ] **Step 2: Apply the migration**

```bash
echo "DATABASE_URL=<session-pooler-url>" > apps/server/.env.local
pnpm --filter server migrate
rm apps/server/.env.local
```

Expected: `applying 026_match_clips.sql … ✓`.

- [ ] **Step 3: Verify the function exists**

Run (temporarily recreating `.env.local`, or via the pooler URL inline):

```bash
echo "DATABASE_URL=<session-pooler-url>" > apps/server/.env.local
pnpm --filter server exec tsx -e "import pg from 'pg'; const c = new pg.Client(process.env.DATABASE_URL); await c.connect(); const r = await c.query(\"select proname from pg_proc where proname = 'match_clips'\"); console.log(r.rows); await c.end();"
rm apps/server/.env.local
```

Expected: `[ { proname: 'match_clips' } ]`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/supabase/migrations/026_match_clips.sql
git commit -m "add match_clips pgvector similarity function

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `enrichClip` reuses existing tags

**Files:**

- Modify: `apps/server/src/services/enrich.ts`
- Test: `apps/server/src/services/__tests__/enrich-tags.test.ts` (create)

**Interfaces:**

- Consumes: nothing new.
- Produces: `EnrichInput` gains `existingTags?: string[]`; the vision/enrich prompt lists them and instructs reuse-first.

- [ ] **Step 1: Write the failing test (mock Anthropic, assert prompt + reuse)**

Create `apps/server/src/services/__tests__/enrich-tags.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

const { enrichClip } = await import("../enrich.js");

describe("enrichClip existing-tag reuse", () => {
  beforeEach(() => {
    layer("unit");
    epic("Enrichment");
    feature("Tag Reuse");
    createMock.mockReset();
  });

  it("passes existing tags into the prompt and returns a reused tag", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: '{"summary":"s","tags":["react"],"category":"reading"}' }],
    });
    const result = await enrichClip({
      sourceType: "web",
      title: "React hooks",
      text: "about react",
      existingTags: ["react", "typescript"],
    });
    expect(result.tags).toEqual(["react"]);
    const prompt = createMock.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("react");
    expect(prompt).toContain("typescript");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/services/__tests__/enrich-tags.test.ts`
Expected: FAIL — `existingTags` not in the type / prompt doesn't include the vocab.

- [ ] **Step 3: Implement**

In `apps/server/src/services/enrich.ts`, add `existingTags?: string[]` to `EnrichInput`, and change the prompt construction in `enrichClip`:

```typescript
export interface EnrichInput {
  sourceType: SourceType;
  title?: string;
  text: string;
  existingTags?: string[];
}
```

```typescript
export async function enrichClip(input: EnrichInput): Promise<Enrichment> {
  const vocab = input.existingTags?.length
    ? `\n\nPrefer tags from this list when they fit: ${JSON.stringify(
        input.existingTags.slice(0, 100),
      )}. Only invent a new tag when none match.`
    : "";
  const prompt =
    `You triage saved clips. Return ONLY JSON: {"summary": string (<=2 sentences), ` +
    `"tags": string[] (2-4 lowercase topic tags), "category": one of ${JSON.stringify(
      Object.values(CLIP_CATEGORIES),
    )}}.${vocab}\n\n` +
    `Source type: ${input.sourceType}\nTitle: ${input.title ?? ""}\n\nContent:\n${input.text.slice(0, 6000)}`;
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.map((b) => ("text" in b ? b.text : "")).join("");
  return parseEnrichment(text);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/server/src/services/__tests__/enrich-tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/enrich.ts apps/server/src/services/__tests__/enrich-tags.test.ts
git commit -m "enrichClip prefers the user's existing tag vocabulary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Feed existing tags from `embed-clip`

**Files:**

- Modify: `apps/server/src/functions/embed-clip.ts`
- Test: `apps/server/src/functions/__tests__/embed-clip.test.ts` (extend)

**Interfaces:**

- Consumes: `enrichClip({ existingTags })` (Task 2).
- Produces: the enrich step fetches the user's distinct tags and passes them.

- [ ] **Step 1: Add `user_id` to the fetch-clip select**

In `apps/server/src/functions/embed-clip.ts`, extend the `fetch-clip` select to include `user_id`, and the `ClipRow` type to include `user_id: string`:

```typescript
type ClipRow = {
  source_type: string;
  author: string | null;
  content: string | null;
  summary_json?: Summary["summaryJson"] | null;
  video_title?: string | null;
  user_id?: string;
};
```

```typescript
        .select(
          "id, source_type, content, summary_json, author, category, tags, video_title, user_id",
        )
```

- [ ] **Step 2: Fetch + pass existing tags in the enrich step**

In the `enrich-clip` `step.run`, before calling `enrichClip`, load the user's distinct tags:

```typescript
const existingTags = await (async () => {
  const { data } = await supabase
    .from("clips")
    .select("tags")
    .eq("user_id", clip.user_id ?? "")
    .is("deleted_at", null)
    .limit(500);
  const set = new Set<string>();
  for (const row of data ?? []) for (const t of (row.tags as string[]) ?? []) set.add(t);
  return [...set];
})();
const e = await enrichClip({
  sourceType: clip.source_type as "web" | "tweet" | "image",
  title: clip.video_title ?? undefined,
  text: clip.content ?? "",
  existingTags,
});
```

- [ ] **Step 3: Verify existing test still passes**

Run: `pnpm vitest run apps/server/src/functions/__tests__/embed-clip.test.ts`
Expected: PASS (the `buildEmbedText` tests are unaffected). Then `pnpm --filter server typecheck` → no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/functions/embed-clip.ts
git commit -m "feed the user's existing tags into clip enrichment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `findRelatedClips` service + `GET /api/clips/:id/related`

**Files:**

- Create: `apps/server/src/services/related.ts`
- Modify: `apps/server/src/routes/clips.ts`
- Test: `apps/server/src/services/__tests__/related.test.ts` (create)

**Interfaces:**

- Consumes: `match_clips` RPC (Task 1), `toClip`, `resolveClipImage`.
- Produces: `findRelatedClips(clipId: string, userId: string, limit?: number): Promise<Summary[]>`; `GET /:id/related` → `{ clips }`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/services/__tests__/related.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock("../../lib/supabase.js", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a), from: (...a: unknown[]) => fromMock(...a) },
}));
vi.mock("../../routes/clips.js", () => ({ resolveClipImage: async (x: unknown) => x }));

const { findRelatedClips } = await import("../related.js");

describe("findRelatedClips", () => {
  beforeEach(() => {
    layer("unit");
    epic("Search");
    feature("Related");
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("returns [] when the source clip has no embedding", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({ single: () => ({ data: { embedding: null }, error: null }) }),
      }),
    });
    expect(await findRelatedClips("c1", "u1")).toEqual([]);
  });

  it("maps matched rows to clips", async () => {
    fromMock
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({ single: () => ({ data: { embedding: [0.1, 0.2] }, error: null }) }),
        }),
      })
      .mockReturnValueOnce({
        select: () => ({
          in: () => ({
            data: [{ id: "c2", source_type: "web", status: "completed", tags: [] }],
            error: null,
          }),
        }),
      });
    rpcMock.mockResolvedValue({ data: [{ id: "c2", similarity: 0.9 }], error: null });
    const out = await findRelatedClips("c1", "u1");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("c2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/services/__tests__/related.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `apps/server/src/services/related.ts`:

```typescript
import type { Summary } from "@cliphy/shared";
import { supabase } from "../lib/supabase.js";
import { toClip } from "../lib/mappers.js";
import { resolveClipImage } from "../routes/clips.js";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export async function findRelatedClips(
  clipId: string,
  userId: string,
  limit = 5,
): Promise<Summary[]> {
  const { data: src, error: srcErr } = await supabase
    .from("clips")
    .select("embedding")
    .eq("id", clipId)
    .single();
  if (srcErr || !src?.embedding) return [];

  const { data: matches, error: rpcErr } = await supabase.rpc("match_clips", {
    query_embedding: src.embedding,
    match_user_id: userId,
    exclude_id: clipId,
    match_count: limit,
  });
  if (rpcErr || !matches?.length) return [];

  const ids = (matches as { id: string }[]).map((m) => m.id);
  const { data: rows, error: rowsErr } = await supabase.from("clips").select("*").in("id", ids);
  if (rowsErr || !rows) return [];

  const order = new Map(ids.map((id, i) => [id, i]));
  const clips = await Promise.all(
    rows.map((r) => resolveClipImage(toClip(r as Record<string, unknown>))),
  );
  return clips.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export { NIL_UUID };
```

- [ ] **Step 4: Add the route**

In `apps/server/src/routes/clips.ts`, add after the POST handler:

```typescript
import { findRelatedClips } from "../services/related.js";
// ...
clipsRoutes.get("/:id/related", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { data: owned } = await supabase
    .from("clips")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!owned) return c.json({ clips: [] });
  const clips = await findRelatedClips(id, userId);
  return c.json({ clips });
});
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm vitest run apps/server/src/services/__tests__/related.test.ts` → PASS
Run: `pnpm --filter server typecheck` → no errors

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/related.ts apps/server/src/routes/clips.ts apps/server/src/services/__tests__/related.test.ts
git commit -m "add related-clips service and GET /api/clips/:id/related

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Semantic search upgrade

**Files:**

- Create: `apps/server/src/services/search.ts`
- Modify: `apps/server/src/routes/summaries.ts`
- Test: `apps/server/src/services/__tests__/search.test.ts` (create)

**Interfaces:**

- Consumes: `generateEmbedding`, `match_clips`, `toClip`.
- Produces: `semanticSearch(userId: string, query: string, limit: number): Promise<Summary[]>`; the `/search` route tries semantic first, falls back to ILIKE.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/services/__tests__/search.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock("../../lib/supabase.js", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a), from: (...a: unknown[]) => fromMock(...a) },
}));
vi.mock("../embedding.js", () => ({ generateEmbedding: vi.fn(async () => [0.1, 0.2]) }));
vi.mock("../../routes/clips.js", () => ({ resolveClipImage: async (x: unknown) => x }));

const { semanticSearch } = await import("../search.js");

describe("semanticSearch", () => {
  beforeEach(() => {
    layer("unit");
    epic("Search");
    feature("Semantic");
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("embeds the query, ranks via match_clips, maps rows", async () => {
    rpcMock.mockResolvedValue({ data: [{ id: "c2", similarity: 0.8 }], error: null });
    fromMock.mockReturnValue({
      select: () => ({
        in: () => ({
          data: [{ id: "c2", source_type: "web", status: "completed", tags: [] }],
          error: null,
        }),
      }),
    });
    const out = await semanticSearch("u1", "hello", 10);
    expect(out[0].id).toBe("c2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/services/__tests__/search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `apps/server/src/services/search.ts`:

```typescript
import type { Summary } from "@cliphy/shared";
import { supabase } from "../lib/supabase.js";
import { toClip } from "../lib/mappers.js";
import { generateEmbedding } from "./embedding.js";
import { resolveClipImage } from "../routes/clips.js";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export async function semanticSearch(
  userId: string,
  query: string,
  limit: number,
): Promise<Summary[]> {
  const embedding = await generateEmbedding(query);
  const { data: matches, error } = await supabase.rpc("match_clips", {
    query_embedding: embedding,
    match_user_id: userId,
    exclude_id: NIL_UUID,
    match_count: limit,
  });
  if (error || !matches?.length) return [];
  const ids = (matches as { id: string }[]).map((m) => m.id);
  const { data: rows } = await supabase.from("clips").select("*").in("id", ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  const clips = await Promise.all(
    (rows ?? []).map((r) => resolveClipImage(toClip(r as Record<string, unknown>))),
  );
  return clips.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
```

- [ ] **Step 4: Wire semantic-first into the route**

In `apps/server/src/routes/summaries.ts`, import `semanticSearch` and try it before the ILIKE query. After computing `q`, `limit`, `offset`, `plan`, insert:

```typescript
// Semantic first; fall back to ILIKE on any failure.
try {
  const semantic = await semanticSearch(userId, q, limit);
  if (semantic.length > 0) {
    return c.json({ summaries: semantic, total: semantic.length, offset, limit });
  }
} catch {
  // fall through to keyword search
}
```

Add `import { semanticSearch } from "../services/search.js";` at the top. Leave the existing ILIKE block as the fallback (unchanged).

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm vitest run apps/server/src/services/__tests__/search.test.ts` → PASS
Run: `pnpm --filter server typecheck` → no errors. Then run existing summaries tests: `pnpm vitest run apps/server/src/routes/__tests__/summaries.test.ts` (if present) → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/search.ts apps/server/src/routes/summaries.ts apps/server/src/services/__tests__/search.test.ts
git commit -m "upgrade /api/summaries/search to semantic with ILIKE fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Mobile API bindings

**Files:**

- Modify: `apps/mobile/lib/api.ts`

**Interfaces:**

- Produces: `getRelatedClips(id: string): Promise<Summary[]>`; `searchClips(q: string): Promise<Summary[]>`.

- [ ] **Step 1: Add the bindings**

In `apps/mobile/lib/api.ts`, after `addClip`:

```typescript
export const getRelatedClips = (id: string) =>
  apiFetch<{ clips: Summary[] }>(`/api/clips/${id}/related`).then((d) => d.clips);

export const searchClips = (q: string) =>
  apiFetch<{ summaries: Summary[] }>(`/api/summaries/search?q=${encodeURIComponent(q)}`).then(
    (d) => d.summaries,
  );
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter mobile typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/api.ts
git commit -m "mobile: add getRelatedClips and searchClips bindings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Mobile "Related" section on the detail screen

**Files:**

- Modify: `apps/mobile/app/summary/[id].tsx`

**Interfaces:**

- Consumes: `getRelatedClips`, `ClipCard`.

- [ ] **Step 1: Fetch related on load + render**

In `apps/mobile/app/summary/[id].tsx`:

- Add state: `const [related, setRelated] = useState<Summary[]>([]);`
- In the existing `useEffect`, after `getSummary`, also call:
  `getRelatedClips(id).then(setRelated).catch(() => {});`
- After `<SummaryContent summary={summary} />`, render:

```tsx
{
  related.length > 0 ? (
    <View className="mt-6">
      <Text
        className="text-base font-bold text-[#111827] dark:text-white mb-3"
        style={{ fontFamily: "DMSans" }}
      >
        Related
      </Text>
      <View className="gap-3">
        {related.map((r) => (
          <ClipCard key={r.id} item={r} />
        ))}
      </View>
    </View>
  ) : null;
}
```

- Add imports: `import { getSummary, getRelatedClips } from "../../lib/api";` (extend the existing import) and `import { ClipCard } from "../../components/ClipCard";`. Add `Summary` to the `@cliphy/shared` type import if not already present.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter mobile typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/summary/[id].tsx
git commit -m "mobile: show related clips on the detail screen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Mobile inbox search field + smoke/docs

**Files:**

- Modify: `apps/mobile/app/(tabs)/index.tsx`
- Create: `apps/server/scripts/smoke-test-search.test.ts`
- Create: `docs/decisions/0045-semantic-search-via-match-clips.md`
- Create: `docs/devlog/2026-09-06-enrichment-and-semantic-search.md`

**Interfaces:**

- Consumes: `searchClips`.

- [ ] **Step 1: Add the search field**

In `apps/mobile/app/(tabs)/index.tsx`:

- Add state: `const [searchQuery, setSearchQuery] = useState("");` and `const [searchResults, setSearchResults] = useState<Summary[] | null>(null);`
- Add a debounced effect:

```tsx
useEffect(() => {
  const q = searchQuery.trim();
  if (!q) {
    setSearchResults(null);
    return;
  }
  const t = setTimeout(() => {
    searchClips(q)
      .then(setSearchResults)
      .catch(() => setSearchResults([]));
  }, 300);
  return () => clearTimeout(t);
}, [searchQuery]);
```

- Add a `TextInput` below the header row:

```tsx
<View className="px-4 pt-3">
  <TextInput
    value={searchQuery}
    onChangeText={setSearchQuery}
    placeholder="Search your clips"
    placeholderTextColor="#9ca3af"
    className="border-2 border-black dark:border-[#505050] rounded-lg px-3 py-2 text-[#111827] dark:text-white bg-[#f9fafb] dark:bg-[#282828]"
    style={{ fontFamily: "DMSans" }}
    accessibilityLabel="Search clips"
  />
</View>
```

- When `searchResults !== null`, render the FlatList from `searchResults` and hide the category chips; otherwise the normal `visibleItems`. Concretely, compute `const listData = searchResults ?? visibleItems;` and use it as the FlatList `data`; wrap the category-chip row in `{searchResults === null && ( ... )}`.
- Add `TextInput` to the `react-native` import and `searchClips` to the api import.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter mobile typecheck`
Expected: no errors.

- [ ] **Step 3: Smoke test (opt-in)**

Create `apps/server/scripts/smoke-test-search.test.ts` guarded by `RUN_CLIP_SMOKE=1` that calls `generateEmbedding("test query")` and asserts a 1024-length vector (proves the embedding path search depends on). Keep it minimal — the `match_clips` RPC itself is covered by the migration verify step.

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { generateEmbedding } from "../src/services/embedding.js";

const run = process.env.RUN_CLIP_SMOKE === "1";
const maybe = run ? it : it.skip;

describe("search embedding smoke (live)", () => {
  beforeEach(() => {
    layer("integration");
    epic("Search");
    feature("Embedding Smoke");
  });

  maybe(
    "embeds a query to 1024 dims",
    async () => {
      const v = await generateEmbedding("distributed systems consensus");
      expect(v).toHaveLength(1024);
    },
    30_000,
  );
});
```

Run: `RUN_CLIP_SMOKE=1 pnpm vitest run apps/server/scripts/smoke-test-search.test.ts` → PASS.

- [ ] **Step 4: ADR + devlog**

Create `docs/decisions/0045-semantic-search-via-match-clips.md` (read the decision schema first): pgvector `match_clips` over the existing HNSW cosine index powering both related-clips and semantic search; ILIKE fallback; per-user filtering; tag-vocabulary reuse in enrichment. Create `docs/devlog/2026-09-06-enrichment-and-semantic-search.md` (read the devlog schema first) summarizing what shipped + follow-ups.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(tabs)/index.tsx" apps/server/scripts/smoke-test-search.test.ts docs/decisions docs/devlog
git commit -m "mobile: inbox semantic search field; add search smoke test and docs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

- `match_clips` function → Task 1 ✓
- Existing-tag reuse in enrichment → Tasks 2, 3 ✓
- Related-clips service + endpoint → Task 4 ✓
- Semantic search + ILIKE fallback → Task 5 ✓
- Mobile bindings → Task 6 ✓
- Related section → Task 7 ✓
- Inbox search → Task 8 ✓
- Testing (unit + smoke) → every task + Task 8 ✓

**Placeholder scan:** none. Each edit shows the exact code against quoted anchors.

**Type consistency:** `match_clips` args `{ query_embedding, match_user_id, exclude_id, match_count }` are identical in Tasks 1, 4, 5. `findRelatedClips(clipId, userId, limit)` (Task 4) consumed by Task 7 via `getRelatedClips` (Task 6). `semanticSearch(userId, query, limit)` (Task 5) consumed by the route (Task 5) and `searchClips` (Task 6). `resolveClipImage` imported from `routes/clips.js` in Tasks 4 and 5 (already exported there in subproject #2). `EnrichInput.existingTags` (Task 2) supplied by Task 3.

**Note:** `related.ts` and `search.ts` both import `resolveClipImage` from `../routes/clips.js`, and `clips.ts` imports `findRelatedClips` from `../services/related.js` — a route↔service cycle. It resolves fine under ESM (function bodies run lazily), and the `related.test.ts` mock of `../../routes/clips.js` avoids loading the route in unit tests. If the cycle ever causes an init-order issue, move `resolveClipImage` to `lib/storage.ts`; not needed now.
