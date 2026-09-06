---
title: "Enrichment improvements & semantic search"
date: 2026-09-06
phase: "Clipping-platform pivot (subproject #3)"
---

**Shipped subproject #3: auto-tagging now reuses the user's existing vocabulary, and the stored-but-unused clip embeddings now power related-clips + semantic search.**

## What got done

- Migration `026`: `match_clips(query_embedding, match_user_id, exclude_id,
match_count)` pgvector function over the existing HNSW cosine index; recreated
  `clips_embedding_idx` on the (renamed) `clips` table.
- `enrich.ts`: `EnrichInput.existingTags` + prompt ("prefer these tags; coin new
  only when none fit").
- `embed-clip.ts`: enrich step fetches the user's distinct tags (needs `user_id` in
  the select) and passes them to `enrichClip`.
- `services/related.ts` + `GET /api/clips/:id/related`: nearest 5 clips by embedding
  (ownership-checked), mapped + image-signed.
- `services/search.ts` + `/api/summaries/search`: semantic-first (embed query →
  `match_clips`), ILIKE fallback on empty/error, free-tier window preserved.
- Refactor: moved `resolveClipImage` from `routes/clips.ts` to `lib/storage.ts` to
  break a route↔service import cycle (related/search need it; clips needs related).
- Mobile: `getRelatedClips` + `searchClips` bindings; a "Related" section on the
  detail screen; a debounced search field on the inbox (results replace the list,
  category chips hide while searching).
- Live search smoke test (`RUN_CLIP_SMOKE=1`) added — see Issues re: Voyage key.

## Decisions

- One `match_clips` SQL function powers both related-clips and semantic search;
  ILIKE remains the fallback. Tag reuse happens at write-time in enrichment. See
  ADR 0045.

## Issues

- **Voyage key absent in this sandbox** — the search smoke test (and the pre-existing
  `embedding.test.ts`) fail locally with `401 Provided API key is invalid` because
  `.env` has the `your_voyage_key_here` placeholder. The mocked unit tests pass;
  production/CI have the real `VOYAGE_API_KEY`. Not a code defect.
- **Same 5 pre-existing failures** (`summarize-video`, `admin/users`, `embedding`)
  persist in-sandbox; none touched by this subproject.

## What to remember

- `match_clips` args are `{ query_embedding, match_user_id, exclude_id, match_count }`
  — identical in `related.ts` and `search.ts`. Semantic search excludes the nil UUID.
- `resolveClipImage` now lives in `lib/storage.ts` (was `routes/clips.ts`); all
  read paths import it from there.
- Search spends one Voyage embedding call per query — fine at current volume; add a
  cache if it grows.

---

## Commits

- feat: add match_clips pgvector similarity function
- feat: enrichClip prefers the user's existing tag vocabulary
- feat: feed the user's existing tags into clip enrichment
- feat: add related-clips service and GET /api/clips/:id/related
- feat: upgrade /api/summaries/search to semantic with ILIKE fallback
- feat: mobile add getRelatedClips and searchClips bindings
- feat: mobile show related clips on the detail screen
- feat: mobile inbox semantic search field; add search smoke test and docs

## Tomorrow's plan

- Subproject #4: the polished inbox/detail UX redesign (incl. a proper search
  surface), the last piece of the clipping-platform pivot.
