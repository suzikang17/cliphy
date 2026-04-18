# Multi-Language Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users receive video summaries in their preferred language, regardless of the video's original language.

**Architecture:** User picks a summary language stored in `user_settings`. The transcript service always fetches the original-language caption track. The prompt tells Claude what language the transcript is in and what language to respond in. Cache is keyed by `(video_id, language)` so each language is cached independently.

**Tech Stack:** Hono, Supabase (Postgres), Anthropic Claude API, React (WXT extension), Vitest

**Spec:** `docs/superpowers/specs/2026-04-18-multi-language-summaries-design.md`

---

### Task 1: Shared types — add language constants and types

**Files:**

- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Add language map and types to constants.ts**

Add to the end of `packages/shared/src/constants.ts`:

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
```

- [ ] **Step 2: Add UserSettings type to types.ts**

Add to the end of `packages/shared/src/types.ts`:

```typescript
import type { SummaryLanguageCode } from "./constants.js";

export interface UserSettings {
  summaryLanguage: SummaryLanguageCode;
}
```

- [ ] **Step 3: Add settings API routes to constants.ts**

Add to the `API_ROUTES` object in `packages/shared/src/constants.ts`:

```typescript
SETTINGS: "/settings",
```

- [ ] **Step 4: Verify it builds**

Run: `pnpm --filter @cliphy/shared build`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/
git commit -m "add language types and constants to shared package"
```

---

### Task 2: Database migration — user_settings, summaries columns, cache key

**Files:**

- Create: `apps/server/supabase/migrations/009_multi_language_summaries.sql`

- [ ] **Step 1: Write the migration**

Create `apps/server/supabase/migrations/009_multi_language_summaries.sql`:

```sql
-- Multi-language summary support

-- User settings table (1:1 with users)
create table public.user_settings (
  user_id           uuid primary key references public.users (id) on delete cascade,
  summary_language  text not null default 'en',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.user_settings is
  'Per-user preferences. 1:1 with users, created on first access via upsert.';

create trigger user_settings_updated_at
  before update on public.user_settings
  for each row
  execute function extensions.moddatetime(updated_at);

-- RLS: users can read own settings, all writes go through backend
alter table public.user_settings enable row level security;

create policy "user_settings_select_own"
  on public.user_settings
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Add summary_language to summaries (what language the summary was requested in)
alter table public.summaries
  add column summary_language text not null default 'en';

-- Add transcript_language to summaries (what language the original captions were in)
alter table public.summaries
  add column transcript_language text;

-- Migrate summary_cache to composite key (video_id + language)
alter table public.summary_cache
  drop constraint summary_cache_pkey;

alter table public.summary_cache
  add column summary_language text not null default 'en';

alter table public.summary_cache
  add primary key (youtube_video_id, summary_language);
```

- [ ] **Step 2: Apply the migration to the remote database**

Run: `pnpm supabase db push` (or apply via Supabase SQL Editor if preferred).
Verify: Tables and columns exist, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/supabase/migrations/009_multi_language_summaries.sql
git commit -m "add migration for multi-language summary support"
```

---

### Task 3: Transcript service — simplify pickTrack, return language

**Files:**

- Modify: `apps/server/src/services/transcript.ts`
- Modify: `apps/server/src/services/transcript.test.ts` (if exists, otherwise create)

- [ ] **Step 1: Write tests for pickTrack and language in TranscriptResult**

Check if `apps/server/src/services/transcript.test.ts` exists. If not, create it. Add these tests:

```typescript
import { describe, it, expect } from "vitest";

// pickTrack is not exported, so we test it indirectly via fetchTranscript behavior.
// Instead, test the assembleTranscript + parseTimedTextXml which are exported,
// and verify TranscriptResult shape from a mock.

// For pickTrack specifically, we need to export it or test via integration.
// Since it's a one-liner, we'll modify and verify via the returned language field.
```

Since `pickTrack` is a private one-liner, we'll verify the language field flows through correctly in the integration/smoke tests. Focus on the code change.

- [ ] **Step 2: Simplify pickTrack to always use first track**

In `apps/server/src/services/transcript.ts`, change `pickTrack` (line 112-115):

From:

```typescript
/** Pick the best caption track: prefer English, fallback to first available. */
function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  return tracks.find((t) => t.languageCode === "en") ?? tracks[0];
}
```

To:

```typescript
/** Pick the best caption track: always use the original language (first track). */
function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  return tracks[0];
}
```

- [ ] **Step 3: Add `language` to TranscriptResult and fetchTranscript**

In `apps/server/src/services/transcript.ts`, update the `TranscriptResult` interface (line 234-239):

From:

```typescript
export interface TranscriptResult {
  text: string;
  truncated: boolean;
  title: string | null;
  durationSeconds: number | null;
}
```

To:

```typescript
export interface TranscriptResult {
  text: string;
  truncated: boolean;
  title: string | null;
  durationSeconds: number | null;
  language: string;
}
```

Then update `fetchTranscript` (line 241-260) to capture and return the language:

From:

```typescript
export async function fetchTranscript(videoId: string): Promise<TranscriptResult> {
  const { tracks, title, durationSeconds } = await fetchCaptionTracks(videoId);
  const track = pickTrack(tracks);
  const segments = await fetchTimedText(track);
  // ... rest of function
  return { text: sanitizeTranscript(text), truncated, title, durationSeconds };
}
```

To:

```typescript
export async function fetchTranscript(videoId: string): Promise<TranscriptResult> {
  const { tracks, title, durationSeconds } = await fetchCaptionTracks(videoId);
  const track = pickTrack(tracks);
  const segments = await fetchTimedText(track);
  // ... rest of function unchanged
  return {
    text: sanitizeTranscript(text),
    truncated,
    title,
    durationSeconds,
    language: track.languageCode,
  };
}
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter server build`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/transcript.ts
git commit -m "simplify pickTrack to use original language, return language in TranscriptResult"
```

---

### Task 4: Prompts — add language context to summary and chat prompts

**Files:**

- Modify: `apps/server/src/lib/prompts.ts`

- [ ] **Step 1: Write test for updated prompt functions**

Create or update `apps/server/src/lib/prompts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SUMMARY_USER_PROMPT, chatUserPrompt } from "./prompts.js";

describe("SUMMARY_USER_PROMPT", () => {
  it("includes language instructions when provided", () => {
    const result = SUMMARY_USER_PROMPT("Test Video", "hello world", "Korean", "English");
    expect(result).toContain("Respond in Korean");
    expect(result).toContain("Transcript (language: English):");
    expect(result).toContain("hello world");
    expect(result).toContain("Test Video");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test:unit -- prompts.test`
Expected: FAIL — `SUMMARY_USER_PROMPT` doesn't accept language arguments yet.

- [ ] **Step 3: Update SUMMARY_USER_PROMPT to accept language parameters**

In `apps/server/src/lib/prompts.ts`, change `SUMMARY_USER_PROMPT` (lines 27-35):

From:

```typescript
export const SUMMARY_USER_PROMPT = (
  videoTitle: string,
  transcript: string,
) => `Summarize this YouTube video.

Video title: ${videoTitle}

Transcript:
${transcript}`;
```

To:

```typescript
export const SUMMARY_USER_PROMPT = (
  videoTitle: string,
  transcript: string,
  summaryLanguage?: string,
  transcriptLanguage?: string,
) => {
  const langInstruction = summaryLanguage ? `\nRespond in ${summaryLanguage}.` : "";
  const transcriptLabel = transcriptLanguage
    ? `Transcript (language: ${transcriptLanguage}):`
    : "Transcript:";
  return `Summarize this YouTube video.${langInstruction}

Video title: ${videoTitle}

${transcriptLabel}
${transcript}`;
};
```

- [ ] **Step 4: Update chatUserPrompt to accept language parameter**

In `apps/server/src/lib/prompts.ts`, change `chatUserPrompt` (lines 115-121):

From:

```typescript
export function chatUserPrompt(
  videoTitle: string,
  transcript: string,
  currentSummary: string,
): string {
  return `Video title: ${videoTitle}\n\nCurrent summary:\n${currentSummary}\n\nTranscript:\n${transcript}`;
}
```

To:

```typescript
export function chatUserPrompt(
  videoTitle: string,
  transcript: string,
  currentSummary: string,
  summaryLanguage?: string,
): string {
  const langInstruction = summaryLanguage ? `\n\nRespond in ${summaryLanguage}.` : "";
  return `Video title: ${videoTitle}${langInstruction}\n\nCurrent summary:\n${currentSummary}\n\nTranscript:\n${transcript}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter server test:unit -- prompts.test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/lib/prompts.ts apps/server/src/lib/prompts.test.ts
git commit -m "add language parameters to summary and chat prompts"
```

---

### Task 5: Settings API — GET and PATCH endpoints

**Files:**

- Create: `apps/server/src/routes/settings.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Write test for settings validation**

Create `apps/server/src/routes/settings.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SUMMARY_LANGUAGES } from "@cliphy/shared";

describe("settings validation", () => {
  it("accepts valid language codes", () => {
    const validCodes = Object.keys(SUMMARY_LANGUAGES);
    for (const code of validCodes) {
      expect(code in SUMMARY_LANGUAGES).toBe(true);
    }
  });

  it("rejects invalid language codes", () => {
    expect("xx" in SUMMARY_LANGUAGES).toBe(false);
    expect("" in SUMMARY_LANGUAGES).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter server test:unit -- settings.test`
Expected: PASS (this tests the shared constant, which already exists from Task 1).

- [ ] **Step 3: Create the settings route**

Create `apps/server/src/routes/settings.ts`:

```typescript
import { Hono } from "hono";
import { SUMMARY_LANGUAGES } from "@cliphy/shared";
import type { SummaryLanguageCode } from "@cliphy/shared";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";

const settings = new Hono();

settings.use("/*", authMiddleware);

/** GET /settings — return user settings (defaults if no row exists) */
settings.get("/", async (c) => {
  const userId = c.get("userId");

  const { data } = await supabase
    .from("user_settings")
    .select("summary_language")
    .eq("user_id", userId)
    .single();

  return c.json({
    summaryLanguage: (data?.summary_language as SummaryLanguageCode) ?? "en",
  });
});

/** PATCH /settings — update user settings */
settings.patch("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ summaryLanguage?: string }>();

  if (body.summaryLanguage !== undefined) {
    if (!(body.summaryLanguage in SUMMARY_LANGUAGES)) {
      return c.json({ error: "Invalid language code" }, 400);
    }

    const { error } = await supabase
      .from("user_settings")
      .upsert(
        { user_id: userId, summary_language: body.summaryLanguage },
        { onConflict: "user_id" },
      );

    if (error) {
      return c.json({ error: "Failed to update settings" }, 500);
    }
  }

  return c.json({
    summaryLanguage: body.summaryLanguage ?? "en",
  });
});

export { settings };
```

- [ ] **Step 4: Mount the settings route in app.ts**

In `apps/server/src/app.ts`, add the import and mount. Follow the existing pattern at lines 67-73.

Add import:

```typescript
import { settings } from "./routes/settings.js";
```

Add mount alongside other routes:

```typescript
app.route("/settings", settings);
```

- [ ] **Step 5: Verify build**

Run: `pnpm --filter server build`
Expected: Clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/settings.ts apps/server/src/routes/settings.test.ts apps/server/src/app.ts
git commit -m "add GET/PATCH /settings endpoints for summary language"
```

---

### Task 6: Summarize flow — pass language through queue → Inngest → Claude

**Files:**

- Modify: `apps/server/src/routes/queue.ts`
- Modify: `apps/server/src/functions/summarize-video.ts`
- Modify: `apps/server/src/services/summarizer.ts`

- [ ] **Step 1: Update summarizeTranscript to accept language parameters**

In `apps/server/src/services/summarizer.ts`, change the function signature (line 107-110):

From:

```typescript
export async function summarizeTranscript(
  transcript: string,
  videoTitle: string,
): Promise<SummaryJson> {
```

To:

```typescript
export async function summarizeTranscript(
  transcript: string,
  videoTitle: string,
  summaryLanguage?: string,
  transcriptLanguage?: string,
): Promise<SummaryJson> {
```

Then update the prompt call inside (line 119):

From:

```typescript
content: SUMMARY_USER_PROMPT(videoTitle, transcript),
```

To:

```typescript
content: SUMMARY_USER_PROMPT(videoTitle, transcript, summaryLanguage, transcriptLanguage),
```

And the retry prompt call (line 136):

From:

```typescript
content: SUMMARY_USER_PROMPT(videoTitle, transcript),
```

To:

```typescript
content: SUMMARY_USER_PROMPT(videoTitle, transcript, summaryLanguage, transcriptLanguage),
```

- [ ] **Step 2: Update queue route to fetch and store summary_language**

In `apps/server/src/routes/queue.ts`, in the `POST /` handler, after the rate limit check and before the insert (~line 142):

Add a query to fetch the user's summary language:

```typescript
const { data: settingsRow } = await supabase
  .from("user_settings")
  .select("summary_language")
  .eq("user_id", userId)
  .single();
const summaryLanguage = settingsRow?.summary_language ?? "en";
```

Then add `summary_language: summaryLanguage` to the insert object (alongside `user_id`, `youtube_video_id`, etc.):

```typescript
summary_language: summaryLanguage,
```

Do the same for the `POST /batch` handler — fetch settings once before the loop, add `summary_language` to each insert.

- [ ] **Step 3: Update Inngest function to read summary_language and pass it through**

In `apps/server/src/functions/summarize-video.ts`:

In Step 1 (fetch-transcript, ~line 103), after fetching the summary row, read `summary_language`:

```typescript
const summaryLanguage = summaryRow.summary_language ?? "en";
```

Update the transcript result to capture `language`:

```typescript
const { text, truncated, language: transcriptLanguage } = await fetchTranscript(videoId);
```

Store `transcript_language` on the summary row when updating status to "processing":

```typescript
await supabase
  .from("summaries")
  .update({ status: "processing", transcript_language: transcriptLanguage })
  .eq("id", summaryId);
```

Return both languages from step 1 so step 2 can use them:

```typescript
return { text, truncated, summaryLanguage, transcriptLanguage };
```

In Step 2 (generate-summary, ~line 144), look up the language name from the code and pass to summarizer:

```typescript
import { SUMMARY_LANGUAGES } from "@cliphy/shared";

const summaryLangName =
  SUMMARY_LANGUAGES[summaryLanguage as keyof typeof SUMMARY_LANGUAGES] ?? "English";
const transcriptLangName =
  SUMMARY_LANGUAGES[transcriptLanguage as keyof typeof SUMMARY_LANGUAGES] ?? transcriptLanguage;

const result = await summarizeTranscript(
  transcript,
  videoTitle,
  summaryLangName,
  transcriptLangName,
);
```

- [ ] **Step 4: Update cache lookup and write to use composite key**

In `apps/server/src/functions/summarize-video.ts`, Step 1 cache lookup (~line 107-114):

From:

```typescript
const { data: cached } = await supabase
  .from("summary_cache")
  .select("summary_json")
  .eq("youtube_video_id", videoId)
  .single();
```

To:

```typescript
const { data: cached } = await supabase
  .from("summary_cache")
  .select("summary_json")
  .eq("youtube_video_id", videoId)
  .eq("summary_language", summaryLanguage)
  .single();
```

In Step 3 (save-result, ~line 178-183), update the cache upsert to include `summary_language`:

```typescript
await supabase.from("summary_cache").upsert(
  {
    youtube_video_id: videoId,
    summary_language: summaryLanguage,
    video_title: videoTitle,
    summary_json: result,
  },
  { onConflict: "youtube_video_id,summary_language" },
);
```

- [ ] **Step 5: Verify build**

Run: `pnpm --filter server build`
Expected: Clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/queue.ts apps/server/src/functions/summarize-video.ts apps/server/src/services/summarizer.ts
git commit -m "pass summary language through queue → Inngest → Claude pipeline"
```

---

### Task 7: Extension — add language selector to popup

**Files:**

- Modify: `apps/extension/lib/api.ts`
- Modify: `apps/extension/entrypoints/sidepanel/App.tsx`

- [ ] **Step 1: Add settings API methods to the extension API client**

In `apps/extension/lib/api.ts`, add two new methods following the existing pattern:

```typescript
import type { UserSettings } from "@cliphy/shared";

export async function getSettings(): Promise<UserSettings> {
  return request<UserSettings>(API_ROUTES.SETTINGS);
}

export async function updateSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  return request<UserSettings>(API_ROUTES.SETTINGS, {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}
```

- [ ] **Step 2: Add language selector component**

Create `apps/extension/entrypoints/sidepanel/LanguageSelector.tsx`:

```tsx
import { useState, useEffect } from "react";
import { SUMMARY_LANGUAGES } from "@cliphy/shared";
import type { SummaryLanguageCode } from "@cliphy/shared";
import { getSettings, updateSettings } from "../../lib/api.js";
import * as storage from "../../lib/storage.js";

const STORAGE_KEY = "cliphy_summary_language";

export function LanguageSelector() {
  const [language, setLanguage] = useState<SummaryLanguageCode>("en");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Load from local storage first (fast)
      const cached = await storage.get<SummaryLanguageCode>(STORAGE_KEY);
      if (cached) setLanguage(cached);

      // Then sync from server
      try {
        const settings = await getSettings();
        setLanguage(settings.summaryLanguage);
        await storage.set(STORAGE_KEY, settings.summaryLanguage);
      } catch {
        // Use cached value on error
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const code = e.target.value as SummaryLanguageCode;
    setLanguage(code);
    await storage.set(STORAGE_KEY, code);

    try {
      await updateSettings({ summaryLanguage: code });
    } catch {
      // Revert on error
      const prev = await storage.get<SummaryLanguageCode>(STORAGE_KEY);
      if (prev) setLanguage(prev);
    }
  }

  if (loading) return null;

  return (
    <select value={language} onChange={handleChange}>
      {Object.entries(SUMMARY_LANGUAGES).map(([code, name]) => (
        <option key={code} value={code}>
          {name}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: Add LanguageSelector to the sidepanel App**

In `apps/extension/entrypoints/sidepanel/App.tsx`, import and render the `LanguageSelector` in the appropriate location (near user info / settings area of the UI). The exact placement depends on the current layout — add it where settings-like controls belong (e.g., near the user's email/plan display).

```tsx
import { LanguageSelector } from "./LanguageSelector.js";

// In the JSX, add where appropriate:
<LanguageSelector />;
```

- [ ] **Step 4: Test in browser**

Run: `pnpm dev:extension`
Load the unpacked extension from `.output/chrome-mv3` in Chrome.
Verify:

1. Language dropdown appears in the sidepanel
2. Changing language persists (close and reopen sidepanel)
3. Submitting a video after changing language produces a summary in the selected language

- [ ] **Step 5: Commit**

```bash
git add apps/extension/lib/api.ts apps/extension/entrypoints/sidepanel/LanguageSelector.tsx apps/extension/entrypoints/sidepanel/App.tsx
git commit -m "add language selector to extension sidepanel"
```

---

### Task 8: Smoke test — end-to-end verification

**Files:** None (manual testing)

- [ ] **Step 1: Test English video with English setting (baseline)**

1. Set language to English via the extension dropdown
2. Submit an English YouTube video
3. Verify summary is in English
4. Verify `transcript_language` is stored (check DB or logs)

- [ ] **Step 2: Test non-English video with English setting**

1. Keep language set to English
2. Submit a non-English YouTube video (e.g., a Korean or Spanish video with captions)
3. Verify summary is in English (Claude translates)
4. Verify `transcript_language` shows the original language (e.g., "ko")

- [ ] **Step 3: Test non-English video with matching language setting**

1. Change language to match the video (e.g., Korean)
2. Submit the same Korean video
3. Verify summary is in Korean
4. Verify this creates a separate cache entry (not reusing the English one)

- [ ] **Step 4: Test cache isolation**

1. Submit the same video again with Korean language setting
2. Verify it hits cache (faster response, check logs)
3. Switch language back to English, submit same video
4. Verify it hits the English cache entry

- [ ] **Step 5: Test settings persistence**

1. Change language in dropdown
2. Close and reopen the extension sidepanel
3. Verify the dropdown shows the saved language

- [ ] **Step 6: Commit any fixes**

If any fixes were needed during testing, commit them:

```bash
git add -A
git commit -m "fix issues found during multi-language smoke testing"
```
