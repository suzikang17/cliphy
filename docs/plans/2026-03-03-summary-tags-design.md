# Summary Tags Design

## Goal

Let users tag saved summaries to organize them by topic. Tags turn the flat summary list into a browsable personal knowledge base.

## Constraints

- Free users: max 3 unique tags. Pro: unlimited.
- Tags managed on summaries page only (sidepanel stays focused on queuing)
- Tags stored server-side (synced across devices)

## Data Model

Add `tags text[]` column to summaries table with GIN index:

```sql
ALTER TABLE summaries ADD COLUMN tags text[] DEFAULT '{}';
CREATE INDEX summaries_tags_idx ON summaries USING GIN (tags);
```

Tags are lowercase, trimmed, 1-30 chars each. Max 10 tags per summary.

## API

### `PATCH /api/summaries/:id/tags`

Set tags for a summary.

- Body: `{ tags: string[] }`
- Validates: tag length, max per summary (10), free user unique tag limit (3)
- Normalizes: lowercase, trim, dedupe
- Returns: `{ tags: string[] }`

### `GET /api/summaries` (updated)

Add optional `tag` query param.

- `?tag=finance` → `WHERE tags @> ARRAY['finance']`

### `GET /api/tags`

List user's unique tags for autocomplete.

- Queries: `SELECT DISTINCT unnest(tags) FROM summaries WHERE user_id = ? AND deleted_at IS NULL`
- Returns: `{ tags: string[] }`

## Type Changes

Add to `Summary` interface in `packages/shared/src/types.ts`:

```typescript
tags: string[];
```

Add to `@cliphy/shared` constants:

```typescript
export const MAX_TAGS_PER_SUMMARY = 10;
export const MAX_FREE_UNIQUE_TAGS = 3;
```

## Extension UI (summaries page)

### List view

- Tag filter dropdown in header bar (next to search)
- Tag chips (pills) below each summary card title

### Detail view

- Editable tag row below video metadata
- Click "+" to add tag → inline input with autocomplete from existing tags
- Click X on chip to remove tag
- Free users see "Upgrade for more tags" when at limit

## Files to Modify

| File                                           | Change                                                         |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `apps/server/supabase/migrations/`             | New migration: add `tags` column + GIN index                   |
| `packages/shared/src/types.ts`                 | Add `tags: string[]` to Summary                                |
| `packages/shared/src/constants.ts`             | Add tag limit constants                                        |
| `apps/server/src/routes/summaries.ts`          | Add PATCH tags endpoint, GET tags endpoint, tag filter on list |
| `apps/extension/entrypoints/summaries/App.tsx` | Tag filter, tag chips on cards, tag editing in detail view     |
| `apps/extension/lib/api.ts`                    | Add `updateTags()`, `getTags()` API functions                  |
