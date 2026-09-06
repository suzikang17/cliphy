# Enrichment Improvements & Semantic Search — Design Spec

**Date:** 2026-09-06
**Status:** Approved, pre-implementation
**Scope:** Subproject #3 of the "universal clipping platform" pivot

## Context

Subprojects #1–#2 shipped universal capture (URLs, web, tweets, images) with
per-clip AI enrichment (summary + tags + category) and stored a Voyage
`voyage-3.5` 1024-dim embedding on every clip. Two gaps remain:

1. **Tag drift.** `enrichClip` generates tags blind — it never sees the user's
   existing tag vocabulary, so it coins `reactjs` when the user already has
   `react`. Filters fragment.
2. **Unused embeddings.** Every clip has an embedding and there is an HNSW cosine
   index, but nothing ever queries it. No related-clips, no semantic search.

This subproject closes both: consistent tagging that reuses the user's vocabulary,
and the first real payoff from embeddings — related clips + semantic search.

## Goals

- `enrichClip` receives the user's existing tags and prefers reusing them, coining
  a new tag only when nothing fits.
- A pgvector similarity function (`match_clips`) over the existing cosine index.
- `GET /api/clips/:id/related` — top-N nearest clips for a given clip.
- Upgrade `/api/summaries/search` from ILIKE-only to semantic (embed the query →
  `match_clips`), falling back to ILIKE when the query is empty or embedding fails.
- Mobile: a "Related" section on the detail screen; a search field on the inbox.

## Non-Goals (this phase)

- A dedicated search tab / screen (a header search field is enough; a full search
  surface belongs to the #4 UX redesign).
- Re-embedding historical clips (they already have embeddings from #1/#2).
- Cross-user or public discovery (strictly per-user).
- Entity extraction / knowledge-graph edges (future backlog).

## Data Model / Migration `026_match_clips.sql`

- Recreate the HNSW index on `clips` (migration 022 created it referencing the
  pre-rename `summaries` name; recreate as `clips_embedding_idx` on `public.clips`
  to be safe/idempotent).
- Create the similarity function:

```sql
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

Cosine distance `<=>` uses the HNSW index; `similarity = 1 - distance`.

## Server

- **`enrich.ts`** — `EnrichInput` gains `existingTags?: string[]`. The prompt gains:
  "Prefer tags from this list when they fit: [...]. Only invent a new tag when none
  match." Parsing/caps unchanged. Backwards compatible (absent → current behavior).
- **`functions/embed-clip.ts`** — in the `enrich-clip` step, first fetch the user's
  distinct tags (select `tags` for the user's non-deleted clips, flatten+dedupe,
  cap ~100) and pass as `existingTags`. Needs the clip's `user_id` in the
  fetch-clip select.
- **`services/related.ts`** — `findRelatedClips(clipId, userId, limit = 5): Promise<Summary[]>`:
  read the clip's `embedding`; if null return `[]`; call `supabase.rpc("match_clips", {...})`;
  fetch the matched rows; map via `toClip` + `resolveClipImage`.
- **`routes/clips.ts`** — `GET /:id/related` → `{ clips }` (ownership-checked via
  `user_id`). Auth middleware already applied to the router.
- **`services/search.ts`** — `semanticSearch(userId, query, limit, offset): Promise<Summary[]>`:
  embed the query with `generateEmbedding`; call `match_clips` (exclude_id = a nil
  UUID `00000000-0000-0000-0000-000000000000`); map rows. On empty query or
  embedding error, the route falls back to the existing ILIKE path.
- **`routes/summaries.ts`** — the search handler tries `semanticSearch` first; on
  empty query or thrown error, uses the current ILIKE query. Free-tier history
  window and pagination preserved.

## Mobile

- **`lib/api.ts`** — `getRelatedClips(id): Promise<Summary[]>` (`GET /api/clips/:id/related`);
  `searchClips(q): Promise<Summary[]>` (`GET /api/summaries/search?q=`).
- **`app/summary/[id].tsx`** — below `SummaryContent`, a "Related" section:
  fetch `getRelatedClips(id)` on load; render up to 5 compact `ClipCard`s; hide the
  section when empty.
- **`app/(tabs)/index.tsx`** — a search `TextInput` in the header (debounced ~300ms):
  non-empty query → `searchClips(q)` results replace the list; empty → normal inbox.
  Reuses `ClipCard` rendering and the category chips are hidden while searching.

## Error Handling

- **No embedding on a clip** (older/failed) → `findRelatedClips` returns `[]`; the
  Related section hides. Never errors.
- **`match_clips` RPC error** → related endpoint returns `{ clips: [] }`; search
  falls back to ILIKE. Logged, not surfaced.
- **Voyage embedding failure during search** → fall back to ILIKE keyword search so
  search always returns something.
- **Ownership** — `match_clips` filters by `match_user_id`; the related endpoint
  confirms the clip belongs to the caller before querying.

## Testing

- **Unit (Vitest):** `enrichClip` includes existing tags in the prompt and reuses a
  matching tag (mocked Anthropic asserting the prompt contains the vocab + parsing);
  `findRelatedClips` maps RPC rows and returns `[]` when the clip has no embedding
  (mocked supabase); search route falls back to ILIKE on empty query (mocked).
- **Migration:** apply `026`; a live smoke test (opt-in `RUN_CLIP_SMOKE=1`) inserts
  two embeddings and asserts `match_clips` ranks the nearer one first — or, simpler,
  asserts the function exists and returns rows for a known user. (Kept minimal.)
- **Mobile:** typecheck; `searchClips`/`getRelatedClips` signatures.

## Build Sequence

1. Migration `026` (index recreate + `match_clips`).
2. `enrich.ts` — `existingTags` param + prompt.
3. `embed-clip.ts` — fetch + pass existing tags (needs `user_id` in select).
4. `services/related.ts` + `GET /api/clips/:id/related`.
5. `services/search.ts` + semantic upgrade of `/api/summaries/search` (ILIKE fallback).
6. Mobile `api.ts` bindings.
7. Mobile detail-screen "Related" section.
8. Mobile inbox search field.
9. Smoke test + devlog + ADR (semantic search via pgvector match_clips; tag reuse).
