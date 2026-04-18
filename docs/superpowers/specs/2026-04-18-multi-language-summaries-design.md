# Multi-Language Summaries

Support video summaries in the user's preferred language, regardless of the video's original language.

## Key Decisions

- Always use the video's original caption track (highest fidelity source). Claude handles translation.
- User picks their preferred summary language, stored in a new `user_settings` table.
- Cache is keyed by `(video_id, summary_language)` — each language cached independently.
- `transcript_language` stored on each summary row for visibility and debugging.
- 20 supported languages to start, easy to expand.
- Language selector added to the extension popup.
- Tags stay English (revisit when full i18n lands).

## Out of Scope

- Full i18n of extension/web app UI (separate future work)
- Auto-detecting user's locale on signup
- Multilingual tags
- Extension options page

## Database

### New table: `user_settings`

```sql
create table public.user_settings (
  user_id           uuid primary key references public.users (id) on delete cascade,
  summary_language  text not null default 'en',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

- 1:1 with `users`, created on first access (upsert pattern).
- `summary_language` stores an ISO 639-1 code (`'en'`, `'ko'`, `'es'`, etc.).
- RLS: users can SELECT their own row. All writes go through backend (service_role).

### New columns on `summaries`

```sql
alter table public.summaries add column summary_language text not null default 'en';
alter table public.summaries add column transcript_language text;
```

- `summary_language` — the language the summary was requested in. Set at insert time from user settings. Defaults to `'en'` for existing rows.
- `transcript_language` — the language of the original caption track. Populated after transcript fetch. Nullable — existing rows won't have it.

### Cache key change: `summary_cache`

```sql
alter table public.summary_cache drop constraint summary_cache_pkey;
alter table public.summary_cache add column summary_language text not null default 'en';
alter table public.summary_cache add primary key (youtube_video_id, summary_language);
```

- Cache keyed by `(video_id, language)`.
- Existing rows default to `'en'` (accurate — all current summaries are English).

## Shared Types

New exports in `@cliphy/shared`:

```typescript
export const SUMMARY_LANGUAGES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ko: "Korean",
  ja: "Japanese",
  zh: "Chinese",
  ar: "Arabic",
  hi: "Hindi",
  it: "Italian",
  ru: "Russian",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  uk: "Ukrainian",
  sv: "Swedish",
} as const;

export type SummaryLanguageCode = keyof typeof SUMMARY_LANGUAGES;

export interface UserSettings {
  summaryLanguage: SummaryLanguageCode;
}
```

`SUMMARY_LANGUAGES` is used for both server-side validation and UI display labels.

`SummaryJson` is unchanged — the structure is the same regardless of language.

## Transcript Service

### `pickTrack()` simplification

Remove English preference. Always return `tracks[0]` (YouTube returns the original language first).

```typescript
function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  return tracks[0];
}
```

### `TranscriptResult` update

Add `language` field:

```typescript
export interface TranscriptResult {
  text: string;
  truncated: boolean;
  title: string | null;
  durationSeconds: number | null;
  language: string; // from CaptionTrack.languageCode
}
```

No other transcript changes needed — XML parsing, sanitization, and assembly are language-agnostic.

## Prompts

### Summary user prompt

Add language context — two new lines:

```
Summarize this YouTube video.
Respond in {summaryLanguage}.

Video title: {videoTitle}

Transcript (language: {transcriptLanguage}):
{transcript}
```

- `summaryLanguage` is the full language name (e.g. "Korean"), not the code ("ko"). Claude understands natural names better.
- `transcriptLanguage` tells Claude what it's reading, improving translation accuracy.

System prompt is unchanged — already language-neutral.

### Chat prompt

Same pattern — add `Respond in {summaryLanguage}` so follow-up chat uses the same language.

### Tag prompts

No changes. Tags stay English.

## API

### New endpoints

**`GET /settings`**

- Returns the user's settings. If no `user_settings` row exists, returns defaults (`{ summaryLanguage: 'en' }`).

**`PATCH /settings`**

- Accepts `{ summaryLanguage: SummaryLanguageCode }`.
- Validates against `SUMMARY_LANGUAGES` keys.
- Upserts the `user_settings` row.

### Summarize flow changes

1. Queue endpoint fetches user's `summary_language` from `user_settings` (default `'en'`) and stores it on the `summaries` row at insert time.
2. Inngest function reads `summary_language` from the `summaries` row.
3. Cache lookup uses `(video_id, summary_language)`.
4. On cache miss: fetch transcript, get `language` from track.
5. Pass `summary_language` + `transcript_language` to prompt.
6. Store `transcript_language` on the `summaries` row.
7. Cache result under `(video_id, summary_language)`.

## Extension

### Popup language selector

- Add a language dropdown to the popup UI.
- Uses `SUMMARY_LANGUAGES` from `@cliphy/shared` for option labels.
- On load: `GET /settings` to show current selection.
- On change: `PATCH /settings` to persist.
- Also store in extension local storage for faster subsequent loads.

## Testing

- Unit tests for updated `pickTrack()` (always returns first track).
- Unit tests for prompt generation with language parameters.
- Unit tests for `PATCH /settings` validation (valid codes accepted, invalid rejected).
- Smoke test: summarize a non-English video, verify summary is in the requested language.
- Smoke test: verify cache serves correct language (same video, two different language settings should produce different summaries).
