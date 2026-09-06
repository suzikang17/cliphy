---
title: "Semantic search + related clips via a pgvector match_clips function"
date: 2026-09-06
category: Tech
revisit: false
---

## Why this choice

Every clip already carried a Voyage `voyage-3.5` 1024-dim embedding and there was
an HNSW cosine index, but nothing queried them — no related-clips, and search was
ILIKE keyword-only. Subproject #3 turns those embeddings into value with a single
SQL function, `match_clips(query_embedding, match_user_id, exclude_id, match_count)`,
that orders `clips` by `embedding <=> query_embedding` (cosine) over the existing
index, scoped to the caller's non-deleted completed clips.

One function powers two features: `GET /api/clips/:id/related` (query = the clip's
own embedding) and semantic `/api/summaries/search` (query = the search string
embedded on the fly). Search tries semantic first and **falls back to the existing
ILIKE keyword query** when the query is empty, embedding fails, or nothing matches —
so search never returns empty-handed due to an embedding hiccup.

Enrichment was also made vocabulary-aware: `enrichClip` now receives the user's
existing tags and is told to prefer them, coining a new tag only when none fit —
stopping `react`/`reactjs` drift so the new filters and search stay coherent.

## Options considered

- **Similarity in SQL (`match_clips`, chosen)** vs. pulling embeddings into Node and
  computing cosine in app code (loses the HNSW index, O(n) per query).
- **A dedicated vector DB** (Pinecone/Qdrant) — rejected; pgvector + the existing
  index is already in Supabase, zero new infra.
- **Semantic-only search** vs. **semantic-with-ILIKE-fallback (chosen)** — the
  fallback guarantees results when embeddings are unavailable and preserves exact
  keyword matches.
- **Tag reuse in enrichment (chosen)** vs. a separate post-hoc tag-consolidation job
  — reuse-at-write is simpler and prevents drift instead of cleaning it up later.

## Tradeoffs

- **Gain:** related-clips and true semantic search from data we already stored, no
  new infra, one reusable RPC, coherent tags.
- **Give up:** search now spends one Voyage embedding call per query (cached by
  nothing yet — acceptable at current volume; revisit with a query cache if it grows).
- **Scope:** a proper search screen/tab is deferred to the #4 UX redesign; this ships
  a header search field and a Related section only.
