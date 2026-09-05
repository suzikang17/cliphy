# Universal Clip Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Cliphy ingest any URL — routing to per-type extractors (web article/visual auto-detect, first-class tweets with self-thread stitching) — and surface every clip in the existing inbox, AI-enriched.

**Architecture:** One universal `POST /api/clips` entry point detects source type and fans out to extractors (`web`, `tweet`; `youtube`/`podcast` unchanged). Extracted clips are saved to the `clips` table and fire `clip/embed.requested`, whose Inngest worker is extended to also produce summary + tags + category. Mobile widens its share intent to accept any URL and renders new per-type cards.

**Tech Stack:** Hono + Supabase + Inngest (server, ESM/NodeNext — relative imports use `.js`), Vitest v4 (tests run from repo root via `pnpm vitest run <path>`), React Native + NativeWind (mobile), `@mozilla/readability` + `linkedom` (web extraction), Twitter syndication API + FixTweet (tweets).

## Global Constraints

- Server relative imports MUST use the `.js` extension (NodeNext ESM). Mobile imports are extensionless.
- The database table is `clips` (snake_case columns). `toClip(row)` in `apps/server/src/lib/mappers.ts` is the only row→API mapper.
- Inngest functions use the array trigger form: `{ id, retries, triggers: [{ event: "..." }] }`.
- New clip creation fires `inngest.send({ name: "clip/embed.requested", data: { clipId } })`.
- Tests run from repo root: `pnpm vitest run <path>` (single test: add `-t "<name>"`). No per-package test script.
- Every Vitest suite tags Allure metadata in `beforeEach`: `layer("unit"); epic(...); feature(...);` — imported from `allure-js-commons`.
- Direct `fetch` first; only route through `fetchViaProxy` (from `apps/server/src/lib/proxy.ts`, env `PROXY_URL`) on a 403/blocked response, to limit proxy cost.
- Migrations live in `apps/server/supabase/migrations/`, applied via `pnpm --filter server migrate` (needs `DATABASE_URL` in `apps/server/.env.local`, deleted after).
- Commit messages: imperative mood. End with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Shared (`packages/shared/src/`)**

- `types.ts` — extend `SourceType`; add `ClipCategory`, `WebClipMetadata`, `TweetClipMetadata`, `TweetMedia`; extend `Summary` with `category`, `heroImageUrl`, `excerpt`.
- `constants.ts` — add `SOURCE_TYPES` + `CLIP_CATEGORIES` runtime constants.

**Server (`apps/server/src/`)**

- `services/detectSourceType.ts` — pure URL → `SourceType` classifier (new).
- `services/extractors/web.ts` — `extractWebClip(url)` (new).
- `services/extractors/tweet.ts` — `extractTweetClip(url)` (new).
- `services/enrich.ts` — `enrichClip(input)` Claude summary+tags+category (new).
- `routes/clips.ts` — widen POST to universal ingest + routing + failure clip (modify).
- `functions/embed-clip.ts` — also run enrichment before embedding (modify).
- `lib/mappers.ts` — map new columns (modify).
- `supabase/migrations/024_universal_clips.sql` — schema (new).

**Mobile (`apps/mobile/`)**

- `lib/api.ts` — add `addClip` (modify).
- `app/_layout.tsx` — widen share intent to any URL (modify).
- `components/ClipCard.tsx` — per-source-type card dispatcher (new).
- `components/TweetCard.tsx`, `components/WebCard.tsx` — type-specific cards (new).
- `app/(tabs)/index.tsx` — use `ClipCard`, add category filter chip (modify).

**Docs**

- `docs/decisions/` — ADR for tweet-fetching approach.
- `docs/devlog/` — session entry.

---

### Task 1: Shared types & constants

**Files:**

- Modify: `packages/shared/src/types.ts` (SourceType line 55; Summary lines 57–85)
- Modify: `packages/shared/src/constants.ts`
- Test: `packages/shared/src/__tests__/clip-types.test.ts` (create)

**Interfaces:**

- Produces: `SourceType` now includes `"web"`; `ClipCategory` union; `WebClipMetadata`, `TweetClipMetadata`, `TweetMedia` interfaces; `Summary.category?: ClipCategory`, `Summary.heroImageUrl?: string`, `Summary.excerpt?: string`; runtime `SOURCE_TYPES`, `CLIP_CATEGORIES`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/clip-types.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { SOURCE_TYPES, CLIP_CATEGORIES } from "../constants";

describe("clip source types & categories", () => {
  beforeEach(() => {
    layer("unit");
    epic("Data");
    feature("Clip Types");
  });

  it("SOURCE_TYPES includes web alongside existing types", () => {
    expect(Object.values(SOURCE_TYPES)).toEqual(
      expect.arrayContaining(["youtube", "tweet", "podcast", "web"]),
    );
  });

  it("CLIP_CATEGORIES exposes the inbox buckets", () => {
    expect(Object.values(CLIP_CATEGORIES)).toEqual(
      expect.arrayContaining(["idea", "reading", "design", "reference"]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/shared/src/__tests__/clip-types.test.ts`
Expected: FAIL — `SOURCE_TYPES`/`CLIP_CATEGORIES` are not exported.

- [ ] **Step 3: Add the constants**

In `packages/shared/src/constants.ts`, after the `SUBSCRIPTION_TYPES` block (line ~58), add:

```typescript
export const SOURCE_TYPES = {
  YOUTUBE: "youtube",
  TWEET: "tweet",
  PODCAST: "podcast",
  WEB: "web",
} as const;

export const CLIP_CATEGORIES = {
  IDEA: "idea",
  READING: "reading",
  DESIGN: "design",
  REFERENCE: "reference",
} as const;
```

- [ ] **Step 4: Extend the types**

In `packages/shared/src/types.ts`, replace line 55:

```typescript
export type SourceType = "youtube" | "tweet" | "podcast" | "web";
```

with the `"web"` member added (as shown). Then add, after the `SummaryJson` interface (line ~53):

```typescript
export type ClipCategory = "idea" | "reading" | "design" | "reference";

export interface TweetMedia {
  type: "photo" | "video" | "gif";
  url: string;
  previewUrl?: string;
}

export interface TweetClipMetadata {
  handle: string;
  avatarUrl?: string;
  media?: TweetMedia[];
  quotedTweet?: { handle: string; text: string } | null;
  threadTweetIds?: string[];
  threadTruncated?: boolean;
  likeCount?: number;
  retweetCount?: number;
}

export interface WebClipMetadata {
  siteName?: string;
  faviconUrl?: string;
  readingTimeMin?: number;
  kind: "article" | "visual";
}
```

In the `Summary` interface (after `sourceMetadata?` on line ~65) add:

```typescript
  category?: ClipCategory;
  heroImageUrl?: string;
  excerpt?: string;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/shared/src/__tests__/clip-types.test.ts`
Expected: PASS. Then `pnpm --filter shared typecheck` → no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/constants.ts packages/shared/src/__tests__/clip-types.test.ts
git commit -m "add web source type, clip categories, and per-type metadata types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: DB migration + mapper for new columns

**Files:**

- Create: `apps/server/supabase/migrations/024_universal_clips.sql`
- Modify: `apps/server/src/lib/mappers.ts` (`toClip`)
- Test: `apps/server/src/lib/__tests__/mappers.test.ts` (add cases; file already exists)

**Interfaces:**

- Consumes: `Summary.category/heroImageUrl/excerpt` (Task 1).
- Produces: `toClip(row)` maps `category`, `hero_image_url`, `excerpt`; DB accepts `source_type = 'web'`.

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/lib/__tests__/mappers.test.ts` inside the existing `describe`:

```typescript
it("maps web clip columns (category, hero_image_url, excerpt)", () => {
  const row = {
    id: "c1",
    user_id: "u1",
    source_type: "web",
    source_url: "https://example.com/post",
    status: "completed",
    category: "reading",
    hero_image_url: "https://example.com/hero.jpg",
    excerpt: "A short preview.",
    tags: [],
    created_at: "2026-09-05T00:00:00Z",
    updated_at: "2026-09-05T00:00:00Z",
  };
  const clip = toClip(row);
  expect(clip.sourceType).toBe("web");
  expect(clip.category).toBe("reading");
  expect(clip.heroImageUrl).toBe("https://example.com/hero.jpg");
  expect(clip.excerpt).toBe("A short preview.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/lib/__tests__/mappers.test.ts -t "web clip columns"`
Expected: FAIL — `clip.category` is `undefined`.

- [ ] **Step 3: Write the migration**

Create `apps/server/supabase/migrations/024_universal_clips.sql`:

```sql
-- apps/server/supabase/migrations/024_universal_clips.sql
-- Universal clip capture: add `web` source type + card display columns.

-- Extend the source_type check constraint to include 'web'.
-- (Existing constraint allows youtube | tweet | podcast.)
alter table public.clips drop constraint if exists clips_source_type_check;
alter table public.clips
  add constraint clips_source_type_check
  check (source_type in ('youtube', 'tweet', 'podcast', 'web'));

-- Card/display + triage columns (all nullable — existing rows stay valid).
alter table public.clips add column if not exists category       text;
alter table public.clips add column if not exists hero_image_url text;
alter table public.clips add column if not exists excerpt        text;

-- Inbox filtering by category.
create index if not exists clips_category_idx on public.clips(category);
```

Note: if the current constraint name differs, adjust the `drop constraint` line. Verify with:
`select conname from pg_constraint where conrelid = 'public.clips'::regclass and contype = 'c';`

- [ ] **Step 4: Update the mapper**

In `apps/server/src/lib/mappers.ts`, inside `toClip`, add after the `sourceMetadata` line:

```typescript
    category: (row.category as Summary["category"]) ?? undefined,
    heroImageUrl: (row.hero_image_url as string) ?? undefined,
    excerpt: (row.excerpt as string) ?? undefined,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run apps/server/src/lib/__tests__/mappers.test.ts -t "web clip columns"`
Expected: PASS.

- [ ] **Step 6: Apply the migration**

```bash
echo "DATABASE_URL=<session-pooler-url>" > apps/server/.env.local
pnpm --filter server migrate
rm apps/server/.env.local
```

Expected: `applying 024_universal_clips.sql … ✓`.

- [ ] **Step 7: Commit**

```bash
git add apps/server/supabase/migrations/024_universal_clips.sql apps/server/src/lib/mappers.ts apps/server/src/lib/__tests__/mappers.test.ts
git commit -m "add universal clip columns and map them in toClip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `detectSourceType` URL classifier

**Files:**

- Create: `apps/server/src/services/detectSourceType.ts`
- Test: `apps/server/src/services/__tests__/detectSourceType.test.ts` (create)

**Interfaces:**

- Consumes: `extractVideoId` from `@cliphy/shared`; `SourceType` (Task 1).
- Produces: `export function detectSourceType(url: string): SourceType` — returns `youtube | tweet | web` (podcast is only reached via subscription flows, not URL paste, so it is out of this classifier's scope; a raw feed URL classifies as `web`).

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/services/__tests__/detectSourceType.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { detectSourceType } from "../detectSourceType.js";

describe("detectSourceType", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Source Detection");
  });

  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://twitter.com/jack/status/20", "tweet"],
    ["https://x.com/jack/status/20", "tweet"],
    ["https://x.com/jack/status/20?s=46", "tweet"],
    ["https://example.com/some-article", "web"],
    ["https://x.com/jack", "web"],
    ["not a url", "web"],
  ])("classifies %s as %s", (url, expected) => {
    expect(detectSourceType(url)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/services/__tests__/detectSourceType.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/services/detectSourceType.ts`:

```typescript
import { extractVideoId, type SourceType } from "@cliphy/shared";

const TWEET_HOSTS = new Set(["twitter.com", "x.com", "mobile.twitter.com"]);

/**
 * Classify a pasted/shared URL. YouTube and tweet URLs are recognized by
 * host + shape; everything else (including raw RSS feeds) falls back to "web".
 * Podcast ingestion happens via subscription flows, not this classifier.
 */
export function detectSourceType(url: string): SourceType {
  if (extractVideoId(url)) return "youtube";
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, "");
    if (TWEET_HOSTS.has(host) && /\/status\/\d+/.test(pathname)) {
      return "tweet";
    }
  } catch {
    return "web";
  }
  return "web";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/server/src/services/__tests__/detectSourceType.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/detectSourceType.ts apps/server/src/services/__tests__/detectSourceType.test.ts
git commit -m "add detectSourceType URL classifier

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Web extractor (article/visual auto-detect)

**Files:**

- Create: `apps/server/src/services/extractors/web.ts`
- Test: `apps/server/src/services/extractors/__tests__/web.test.ts` (create)
- Modify: `apps/server/package.json` (add deps)

**Interfaces:**

- Consumes: `fetchViaProxy` from `../lib/proxy.js`; `WebClipMetadata` (Task 1).
- Produces:

```typescript
export interface WebClip {
  kind: "article" | "visual";
  title: string;
  siteName?: string;
  faviconUrl?: string;
  heroImageUrl?: string;
  excerpt?: string;
  content: string; // markdown/plaintext; "" for visual
  readingTimeMin?: number;
}
export async function extractWebClip(url: string): Promise<WebClip>;
export function classifyAndBuild(html: string, url: string): WebClip; // exported for tests
```

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter server add @mozilla/readability linkedom
```

Expected: both appear under `apps/server/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/services/extractors/__tests__/web.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { classifyAndBuild } from "../web.js";

const ARTICLE_HTML = `<!doctype html><html><head>
  <title>How to Brew Coffee</title>
  <meta property="og:site_name" content="Coffee Blog" />
  <meta property="og:image" content="https://cdn.test/hero.jpg" />
</head><body><article>
  <h1>How to Brew Coffee</h1>
  ${"<p>Grind the beans to a medium consistency and pour slowly over the filter in concentric circles for even extraction.</p>".repeat(12)}
</article></body></html>`;

const VISUAL_HTML = `<!doctype html><html><head>
  <title>Design Studio</title>
  <meta property="og:site_name" content="Studio" />
  <meta property="og:image" content="https://cdn.test/portfolio.jpg" />
  <meta name="description" content="A portfolio of brand systems." />
</head><body><main><div class="gallery"></div></main></body></html>`;

describe("web extractor classification", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Web Extraction");
  });

  it("classifies a text-dense page as an article with reading content", () => {
    const clip = classifyAndBuild(ARTICLE_HTML, "https://coffee.test/brew");
    expect(clip.kind).toBe("article");
    expect(clip.title).toBe("How to Brew Coffee");
    expect(clip.siteName).toBe("Coffee Blog");
    expect(clip.heroImageUrl).toBe("https://cdn.test/hero.jpg");
    expect(clip.content.length).toBeGreaterThan(200);
    expect(clip.readingTimeMin).toBeGreaterThanOrEqual(1);
  });

  it("classifies a sparse page as visual with an excerpt but no body content", () => {
    const clip = classifyAndBuild(VISUAL_HTML, "https://studio.test/");
    expect(clip.kind).toBe("visual");
    expect(clip.heroImageUrl).toBe("https://cdn.test/portfolio.jpg");
    expect(clip.excerpt).toBe("A portfolio of brand systems.");
    expect(clip.content).toBe("");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/services/extractors/__tests__/web.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `apps/server/src/services/extractors/web.ts`:

```typescript
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { fetchViaProxy } from "../../lib/proxy.js";

export interface WebClip {
  kind: "article" | "visual";
  title: string;
  siteName?: string;
  faviconUrl?: string;
  heroImageUrl?: string;
  excerpt?: string;
  content: string;
  readingTimeMin?: number;
}

const ARTICLE_MIN_CHARS = 500;
const WORDS_PER_MIN = 220;

function meta(document: Document, selector: string): string | undefined {
  const el = document.querySelector(selector) as {
    getAttribute(name: string): string | null;
  } | null;
  return el?.getAttribute("content") ?? el?.getAttribute("href") ?? undefined;
}

export function classifyAndBuild(html: string, url: string): WebClip {
  const { document } = parseHTML(html);
  const origin = safeOrigin(url);

  const ogTitle = meta(document, 'meta[property="og:title"]');
  const siteName = meta(document, 'meta[property="og:site_name"]');
  const heroImageUrl = meta(document, 'meta[property="og:image"]');
  const description =
    meta(document, 'meta[name="description"]') ?? meta(document, 'meta[property="og:description"]');
  const favicon =
    meta(document, 'link[rel="icon"]') ?? (origin ? `${origin}/favicon.ico` : undefined);

  // Readability mutates the document, so run it after scraping meta tags.
  const parsed = new Readability(document as unknown as Document).parse();
  const textContent = (parsed?.textContent ?? "").trim();
  const isArticle = textContent.length >= ARTICLE_MIN_CHARS;

  const title = (parsed?.title || ogTitle || document.title || url).trim();

  if (isArticle) {
    const words = textContent.split(/\s+/).length;
    return {
      kind: "article",
      title,
      siteName: siteName ?? parsed?.siteName ?? undefined,
      faviconUrl: favicon,
      heroImageUrl,
      excerpt: (parsed?.excerpt ?? description ?? textContent.slice(0, 200)).trim() || undefined,
      content: textContent,
      readingTimeMin: Math.max(1, Math.round(words / WORDS_PER_MIN)),
    };
  }

  return {
    kind: "visual",
    title,
    siteName,
    faviconUrl: favicon,
    heroImageUrl,
    excerpt: description ?? undefined,
    content: "",
  };
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export async function extractWebClip(url: string): Promise<WebClip> {
  let res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; CliphyBot/1.0)" },
  });
  if (res.status === 403 || res.status === 429) {
    // Datacenter IP blocked — retry through the residential proxy.
    res = await fetchViaProxy(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; CliphyBot/1.0)" },
    });
  }
  if (!res.ok) throw new Error(`Failed to fetch page (${res.status}): ${url}`);
  const html = await res.text();
  return classifyAndBuild(html, url);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run apps/server/src/services/extractors/__tests__/web.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/extractors/web.ts apps/server/src/services/extractors/__tests__/web.test.ts apps/server/package.json ../../pnpm-lock.yaml
git commit -m "add web clip extractor with article/visual auto-detection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Adjust the lockfile path: `git add pnpm-lock.yaml` from repo root.)

---

### Task 5: Tweet extractor (syndication + FixTweet + self-thread stitch)

**Files:**

- Create: `apps/server/src/services/extractors/tweet.ts`
- Test: `apps/server/src/services/extractors/__tests__/tweet.test.ts` (create)

**Interfaces:**

- Consumes: `TweetClipMetadata`, `TweetMedia` (Task 1).
- Produces:

```typescript
export interface TweetClip {
  text: string; // single tweet or stitched thread
  author: { name: string; handle: string; avatarUrl?: string };
  media: TweetMedia[];
  quotedTweet?: { handle: string; text: string } | null;
  threadTweetIds: string[];
  threadTruncated: boolean;
  likeCount?: number;
  retweetCount?: number;
  publishedAt?: string;
  heroImageUrl?: string; // first photo/video preview, for the card
}
export function parseTweetId(url: string): string | null; // exported for tests
export function mapSyndicationTweet(json: unknown): TweetClip; // exported for tests
export async function extractTweetClip(url: string): Promise<TweetClip>;
```

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/services/extractors/__tests__/tweet.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { parseTweetId, mapSyndicationTweet } from "../tweet.js";

const SYNDICATION_JSON = {
  id_str: "20",
  full_text: "just setting up my twttr",
  created_at: "2006-03-21T20:50:14.000Z",
  favorite_count: 100,
  user: {
    name: "jack",
    screen_name: "jack",
    profile_image_url_https: "https://pbs.test/jack.jpg",
  },
  mediaDetails: [{ type: "photo", media_url_https: "https://pbs.test/photo.jpg" }],
};

describe("tweet extractor", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Tweet Extraction");
  });

  it.each([
    ["https://x.com/jack/status/20", "20"],
    ["https://twitter.com/jack/status/20?s=46", "20"],
    ["https://example.com/not/a/tweet", null],
  ])("parses id from %s", (url, expected) => {
    expect(parseTweetId(url)).toBe(expected);
  });

  it("maps syndication JSON to a TweetClip", () => {
    const clip = mapSyndicationTweet(SYNDICATION_JSON);
    expect(clip.text).toBe("just setting up my twttr");
    expect(clip.author.handle).toBe("jack");
    expect(clip.author.avatarUrl).toBe("https://pbs.test/jack.jpg");
    expect(clip.media).toEqual([{ type: "photo", url: "https://pbs.test/photo.jpg" }]);
    expect(clip.heroImageUrl).toBe("https://pbs.test/photo.jpg");
    expect(clip.likeCount).toBe(100);
    expect(clip.threadTweetIds).toEqual(["20"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/services/extractors/__tests__/tweet.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/services/extractors/tweet.ts`:

```typescript
import type { TweetMedia } from "@cliphy/shared";

export interface TweetClip {
  text: string;
  author: { name: string; handle: string; avatarUrl?: string };
  media: TweetMedia[];
  quotedTweet?: { handle: string; text: string } | null;
  threadTweetIds: string[];
  threadTruncated: boolean;
  likeCount?: number;
  retweetCount?: number;
  publishedAt?: string;
  heroImageUrl?: string;
}

const TWEET_HOSTS = new Set(["twitter.com", "x.com", "mobile.twitter.com"]);

export function parseTweetId(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url);
    if (!TWEET_HOSTS.has(hostname.replace(/^www\./, ""))) return null;
    const m = pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

interface SyndicationMedia {
  type?: string;
  media_url_https?: string;
  video_info?: { variants?: { url?: string }[] };
}
interface SyndicationTweet {
  id_str?: string;
  full_text?: string;
  text?: string;
  created_at?: string;
  favorite_count?: number;
  retweet_count?: number;
  user?: { name?: string; screen_name?: string; profile_image_url_https?: string };
  mediaDetails?: SyndicationMedia[];
  quoted_tweet?: { user?: { screen_name?: string }; full_text?: string; text?: string };
}

export function mapSyndicationTweet(json: unknown): TweetClip {
  const t = json as SyndicationTweet;
  const media: TweetMedia[] = (t.mediaDetails ?? []).map((m) => ({
    type: m.type === "video" ? "video" : m.type === "animated_gif" ? "gif" : "photo",
    url:
      m.type === "video"
        ? (m.video_info?.variants?.at(-1)?.url ?? m.media_url_https ?? "")
        : (m.media_url_https ?? ""),
    previewUrl: m.media_url_https,
  }));
  const quoted = t.quoted_tweet
    ? {
        handle: t.quoted_tweet.user?.screen_name ?? "",
        text: t.quoted_tweet.full_text ?? t.quoted_tweet.text ?? "",
      }
    : null;

  return {
    text: (t.full_text ?? t.text ?? "").trim(),
    author: {
      name: t.user?.name ?? "",
      handle: t.user?.screen_name ?? "",
      avatarUrl: t.user?.profile_image_url_https,
    },
    media,
    quotedTweet: quoted,
    threadTweetIds: t.id_str ? [t.id_str] : [],
    threadTruncated: false,
    likeCount: t.favorite_count,
    retweetCount: t.retweet_count,
    publishedAt: t.created_at ? new Date(t.created_at).toISOString() : undefined,
    heroImageUrl: media[0]?.previewUrl ?? media[0]?.url ?? undefined,
  };
}

// Twitter's syndication endpoint requires a token derived from the tweet id.
function syndicationToken(id: string): string {
  const n = (Number(id) / 1e15) * Math.PI;
  return n.toString(6 ** 2).replace(/(0+|\.)/g, "");
}

async function fetchSyndication(id: string): Promise<TweetClip | null> {
  const token = syndicationToken(id);
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  return mapSyndicationTweet(await res.json());
}

async function fetchFixTweet(id: string): Promise<TweetClip | null> {
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { tweet?: Record<string, unknown> };
  const tw = data.tweet as
    | {
        text?: string;
        author?: { name?: string; screen_name?: string; avatar_url?: string };
        media?: { photos?: { url: string }[]; videos?: { url: string; thumbnail_url?: string }[] };
        likes?: number;
        retweets?: number;
        created_at?: string;
      }
    | undefined;
  if (!tw) return null;
  const media: TweetMedia[] = [
    ...(tw.media?.photos ?? []).map((p) => ({ type: "photo" as const, url: p.url })),
    ...(tw.media?.videos ?? []).map((v) => ({
      type: "video" as const,
      url: v.url,
      previewUrl: v.thumbnail_url,
    })),
  ];
  return {
    text: (tw.text ?? "").trim(),
    author: {
      name: tw.author?.name ?? "",
      handle: tw.author?.screen_name ?? "",
      avatarUrl: tw.author?.avatar_url,
    },
    media,
    quotedTweet: null,
    threadTweetIds: [id],
    threadTruncated: false,
    likeCount: tw.likes,
    retweetCount: tw.retweets,
    publishedAt: tw.created_at ? new Date(tw.created_at).toISOString() : undefined,
    heroImageUrl: media[0]?.previewUrl ?? media[0]?.url,
  };
}

export async function extractTweetClip(url: string): Promise<TweetClip> {
  const id = parseTweetId(url);
  if (!id) throw new Error(`Not a tweet URL: ${url}`);
  const clip = (await fetchSyndication(id).catch(() => null)) ?? (await fetchFixTweet(id));
  if (!clip) throw new Error(`Failed to fetch tweet ${id}`);
  return clip;
}
```

Note on self-thread stitching: the syndication payload for a threaded tweet includes sibling tweets under conversation fields that vary; full walk-the-chain stitching is implemented against the live shape in the smoke test (Task 10). For this task the single-tweet path is complete and `threadTweetIds` carries the root id; multi-tweet stitching appends ids + text in publish order when present.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/server/src/services/extractors/__tests__/tweet.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/extractors/tweet.ts apps/server/src/services/extractors/__tests__/tweet.test.ts
git commit -m "add tweet extractor with syndication API and FixTweet fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: AI enrichment service (summary + tags + category)

**Files:**

- Create: `apps/server/src/services/enrich.ts`
- Test: `apps/server/src/services/__tests__/enrich.test.ts` (create)

**Interfaces:**

- Consumes: existing Anthropic client (mirror the pattern in `apps/server/src/services/` used by the summarizer — inspect `summarize`/transcript service for the exact `@anthropic-ai/sdk` import and model constant, and reuse them).
- Produces:

```typescript
export interface EnrichInput {
  sourceType: SourceType;
  title?: string;
  text: string;
}
export interface Enrichment {
  summary: string;
  tags: string[];
  category: ClipCategory;
}
export function parseEnrichment(raw: string): Enrichment; // exported for tests
export async function enrichClip(input: EnrichInput): Promise<Enrichment>;
```

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/services/__tests__/enrich.test.ts`:

````typescript
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { parseEnrichment } from "../enrich.js";

describe("enrichment parsing", () => {
  beforeEach(() => {
    layer("unit");
    epic("Enrichment");
    feature("Parse");
  });

  it("parses a well-formed JSON block", () => {
    const raw =
      '```json\n{"summary":"A note on brand systems.","tags":["design","branding"],"category":"design"}\n```';
    const out = parseEnrichment(raw);
    expect(out.summary).toBe("A note on brand systems.");
    expect(out.tags).toEqual(["design", "branding"]);
    expect(out.category).toBe("design");
  });

  it("falls back to reference category on an invalid category value", () => {
    const raw = '{"summary":"x","tags":[],"category":"nonsense"}';
    expect(parseEnrichment(raw).category).toBe("reference");
  });
});
````

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/services/__tests__/enrich.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

First inspect the existing summarizer for the exact Anthropic import + model:
Run: `grep -rn "@anthropic-ai/sdk\|new Anthropic\|claude-" apps/server/src/services/`
Reuse whatever client construction and model constant it uses. Then create `apps/server/src/services/enrich.ts`:

````typescript
import Anthropic from "@anthropic-ai/sdk";
import { CLIP_CATEGORIES, type ClipCategory, type SourceType } from "@cliphy/shared";

export interface EnrichInput {
  sourceType: SourceType;
  title?: string;
  text: string;
}
export interface Enrichment {
  summary: string;
  tags: string[];
  category: ClipCategory;
}

const VALID_CATEGORIES = new Set<string>(Object.values(CLIP_CATEGORIES));

export function parseEnrichment(raw: string): Enrichment {
  const jsonText = raw.replace(/```json\s*|\s*```/g, "").trim();
  let parsed: { summary?: string; tags?: string[]; category?: string };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = {};
  }
  const category =
    parsed.category && VALID_CATEGORIES.has(parsed.category)
      ? (parsed.category as ClipCategory)
      : "reference";
  return {
    summary: parsed.summary ?? "",
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6) : [],
    category,
  };
}

const MODEL = "claude-sonnet-5"; // match the summarizer's model constant if it differs

export async function enrichClip(input: EnrichInput): Promise<Enrichment> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt =
    `You triage saved clips. Return ONLY JSON: {"summary": string (<=2 sentences), ` +
    `"tags": string[] (2-4 lowercase topic tags), "category": one of ${JSON.stringify(
      Object.values(CLIP_CATEGORIES),
    )}}.\n\n` +
    `Source type: ${input.sourceType}\nTitle: ${input.title ?? ""}\n\nContent:\n${input.text.slice(0, 6000)}`;
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.map((b) => ("text" in b ? b.text : "")).join("");
  return parseEnrichment(text);
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/server/src/services/__tests__/enrich.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/enrich.ts apps/server/src/services/__tests__/enrich.test.ts
git commit -m "add clip enrichment service (summary, tags, category)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Universal `/api/clips` ingest routing

**Files:**

- Modify: `apps/server/src/routes/clips.ts` (full rewrite of the POST handler)
- Test: `apps/server/src/routes/__tests__/clips.test.ts` (create)

**Interfaces:**

- Consumes: `detectSourceType` (T3), `extractWebClip` (T4), `extractTweetClip` (T5), `toClip` (T2), `supabase`, `inngest`.
- Produces: `POST /api/clips` accepts `{ url: string }`, detects type, extracts, saves, fires `clip/embed.requested`, returns `{ clip }` (201). On extractor failure saves a `failed` clip and returns `{ clip }` (201) so nothing is lost.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/routes/__tests__/clips.test.ts` (mirror the mock scaffold from `queue.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature, story } from "allure-js-commons";
import { Hono } from "hono";

function mockChain(result: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "from",
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "neq",
    "in",
    "is",
    "or",
    "order",
    "range",
    "limit",
    "single",
    "maybeSingle",
  ];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(result);
  return chain;
}
let supabaseMock: { from: ReturnType<typeof vi.fn> };
vi.mock("../../lib/supabase.js", () => ({
  supabase: new Proxy(
    {},
    { get: (_, p) => (p === "from" ? (...a: unknown[]) => supabaseMock.from(...a) : undefined) },
  ),
}));
vi.mock("../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
      c.set("userId", "test-user-id");
      await next();
    },
  ),
}));
vi.mock("../../services/detectSourceType.js", () => ({ detectSourceType: vi.fn(() => "web") }));
vi.mock("../../services/extractors/web.js", () => ({
  extractWebClip: vi.fn(async () => ({
    kind: "article",
    title: "T",
    siteName: "S",
    heroImageUrl: "h",
    excerpt: "e",
    content: "body",
    readingTimeMin: 2,
  })),
}));
vi.mock("../../services/extractors/tweet.js", () => ({ extractTweetClip: vi.fn() }));

const { clipsRoutes } = await import("../clips.js");
const { inngest } = await import("../../lib/inngest.js");

function app() {
  const a = new Hono();
  a.route("/clips", clipsRoutes);
  return a;
}

describe("POST /clips universal ingest", () => {
  beforeEach(() => {
    layer("unit");
    epic("Ingest");
    feature("Clips API");
    story("Universal POST");
    vi.clearAllMocks();
  });

  it("extracts a web url, saves the clip, and fires enrichment", async () => {
    supabaseMock = {
      from: vi
        .fn()
        .mockReturnValueOnce(mockChain({ data: null })) // dedup: none
        .mockReturnValueOnce(
          mockChain({
            data: {
              id: "c1",
              source_type: "web",
              status: "completed",
              tags: [],
              created_at: "t",
              updated_at: "t",
            },
            error: null,
          }),
        ), // insert
    };
    const res = await app().request("/clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/post" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.clip.id).toBe("c1");
    expect(inngest.send).toHaveBeenCalledWith({
      name: "clip/embed.requested",
      data: { clipId: "c1" },
    });
  });

  it("rejects a missing url", async () => {
    supabaseMock = { from: vi.fn() };
    const res = await app().request("/clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/server/src/routes/__tests__/clips.test.ts`
Expected: FAIL — current handler expects `sourceType`, not `url`.

- [ ] **Step 3: Rewrite the handler**

Replace the body of `clipsRoutes.post("/", ...)` in `apps/server/src/routes/clips.ts`:

```typescript
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../lib/supabase.js";
import { inngest } from "../lib/inngest.js";
import { toClip } from "../lib/mappers.js";
import { detectSourceType } from "../services/detectSourceType.js";
import { extractWebClip } from "../services/extractors/web.js";
import { extractTweetClip } from "../services/extractors/tweet.js";

export const clipsRoutes = new Hono<AppEnv>();
clipsRoutes.use("*", authMiddleware);

clipsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ url?: string }>();
  if (!body.url) return c.json({ error: "url is required" }, 400);

  const sourceType = detectSourceType(body.url);

  // Dedup: one non-deleted clip per (user, url).
  const { data: existing } = await supabase
    .from("clips")
    .select("id")
    .eq("user_id", userId)
    .eq("source_url", body.url)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return c.json({ error: "DUPLICATE", message: "Clip already saved" }, 409);

  // Build the insert payload from whichever extractor matches.
  const insert: Record<string, unknown> = {
    user_id: userId,
    source_type: sourceType,
    source_url: body.url,
    tags: [],
  };

  try {
    if (sourceType === "web") {
      const web = await extractWebClip(body.url);
      insert.video_title = web.title;
      insert.content = web.content || null;
      insert.excerpt = web.excerpt ?? null;
      insert.hero_image_url = web.heroImageUrl ?? null;
      insert.source_metadata = {
        siteName: web.siteName,
        faviconUrl: web.faviconUrl,
        readingTimeMin: web.readingTimeMin,
        kind: web.kind,
      };
      insert.status = "completed";
    } else if (sourceType === "tweet") {
      const tw = await extractTweetClip(body.url);
      insert.video_title = `${tw.author.name} (@${tw.author.handle})`;
      insert.author = tw.author.handle;
      insert.content = tw.text;
      insert.excerpt = tw.text.slice(0, 200);
      insert.hero_image_url = tw.heroImageUrl ?? null;
      insert.published_at = tw.publishedAt ?? null;
      insert.source_metadata = {
        handle: tw.author.handle,
        avatarUrl: tw.author.avatarUrl,
        media: tw.media,
        quotedTweet: tw.quotedTweet,
        threadTweetIds: tw.threadTweetIds,
        threadTruncated: tw.threadTruncated,
        likeCount: tw.likeCount,
        retweetCount: tw.retweetCount,
      };
      insert.status = "completed";
    } else {
      // youtube/podcast URLs shouldn't reach here from the clips path;
      // save a bare link so nothing is lost.
      insert.status = "completed";
    }
  } catch (err) {
    insert.status = "failed";
    insert.error_message = err instanceof Error ? err.message : "Extraction failed";
    insert.video_title = body.url;
  }

  const { data: row, error } = await supabase.from("clips").insert(insert).select("*").single();
  if (error || !row) return c.json({ error: "Failed to save clip" }, 500);

  await inngest.send({ name: "clip/embed.requested", data: { clipId: row.id } });
  return c.json({ clip: toClip(row) }, 201);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/server/src/routes/__tests__/clips.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck the server**

Run: `pnpm --filter server typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/clips.ts apps/server/src/routes/__tests__/clips.test.ts
git commit -m "make POST /api/clips a universal url ingest with type routing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Wire enrichment into the embed worker

**Files:**

- Modify: `apps/server/src/functions/embed-clip.ts`
- Test: `apps/server/src/functions/__tests__/embed-clip.test.ts` (extend or create)

**Interfaces:**

- Consumes: `enrichClip` (T6), existing `buildEmbedText`.
- Produces: for `web`/`tweet` clips lacking a `summary_json`, the worker writes `category`, `tags`, and an `excerpt`/summary before embedding. YouTube/podcast clips (already summarized) are unchanged.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/functions/__tests__/embed-clip.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { buildEmbedText } from "../embed-clip.js";

describe("buildEmbedText", () => {
  beforeEach(() => {
    layer("unit");
    epic("Enrichment");
    feature("Embed Text");
  });

  it("uses author + content for tweets", () => {
    expect(
      buildEmbedText({ source_type: "tweet", author: "jack", content: "hi", summary_json: null }),
    ).toBe("jack: hi");
  });

  it("uses summary + key points otherwise", () => {
    expect(
      buildEmbedText({
        source_type: "youtube",
        author: null,
        content: null,
        summary_json: { summary: "S", keyPoints: ["a", "b"], timestamps: [] } as never,
      }),
    ).toBe("S a b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails/passes baseline**

Run: `pnpm vitest run apps/server/src/functions/__tests__/embed-clip.test.ts`
Expected: PASS if `buildEmbedText` is already exported (it is). This locks current behavior before we add the enrichment step.

- [ ] **Step 3: Add the enrichment step**

In `apps/server/src/functions/embed-clip.ts`, extend the `select` to include `category, tags, video_title`, import `enrichClip`, and add a `step.run("enrich-clip", ...)` before `store-embedding` that only runs when `source_type` is `web` or `tweet` and `summary_json` is null:

```typescript
import { enrichClip } from "../services/enrich.js";
// ...
// (fetch-clip select becomes:)
//   .select("id, source_type, content, summary_json, author, category, tags, video_title")

if (clip.source_type === "web" || clip.source_type === "tweet") {
  await step.run("enrich-clip", async () => {
    const enrichment = await enrichClip({
      sourceType: clip.source_type as "web" | "tweet",
      title: (clip as { video_title?: string }).video_title,
      text: clip.content ?? "",
    });
    const { error } = await supabase
      .from("clips")
      .update({
        category: enrichment.category,
        tags: enrichment.tags,
        summary_json: { summary: enrichment.summary, keyPoints: [], timestamps: [] },
      })
      .eq("id", clipId);
    if (error) throw new Error(`Failed to enrich ${clipId}: ${error.message}`);
  });
}
```

Place this block after `fetch-clip` returns and before `store-embedding`. (`buildEmbedText` will then pick up the freshly written summary on the tweet/web path via `content`/`summary_json` — no change needed there.)

- [ ] **Step 4: Run test to verify it still passes**

Run: `pnpm vitest run apps/server/src/functions/__tests__/embed-clip.test.ts`
Expected: PASS. Then `pnpm --filter server typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/functions/embed-clip.ts apps/server/src/functions/__tests__/embed-clip.test.ts
git commit -m "enrich web and tweet clips (category, tags, summary) before embedding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Mobile — `addClip` + universal share intent

**Files:**

- Modify: `apps/mobile/lib/api.ts` (add `addClip`)
- Modify: `apps/mobile/app/_layout.tsx` (share-intent effect, ~lines with the YouTube regex)

**Interfaces:**

- Consumes: `apiFetch`, `Summary` type.
- Produces: `export const addClip = (body: { url: string }) => Promise<{ clip: Summary }>`; share intent posts any URL via `addClip`.

- [ ] **Step 1: Add the API method**

In `apps/mobile/lib/api.ts`, after `addToQueue` (line ~120):

```typescript
export const addClip = (body: { url: string }) =>
  apiFetch<{ clip: Summary }>("/api/clips", {
    method: "POST",
    body: JSON.stringify(body),
  });
```

- [ ] **Step 2: Widen the share intent**

In `apps/mobile/app/_layout.tsx`, in the `useShareIntent` effect, replace the YouTube-only regex + rejection with: extract the first URL from the shared text and send it via `addClip`. Replace the block that currently does the `urlMatch` YouTube check and `addToQueue` call:

```typescript
const urlMatch = sharedText.match(/https?:\/\/[^\s]+/);
if (!urlMatch) {
  Alert.alert("No link found", "Share a link to save it to Cliphy.");
  return;
}

processingShareRef.current = true;
addClip({ url: urlMatch[0] })
  .then((res) => {
    Alert.alert("Saved to Cliphy", res.clip.videoTitle || "Clip saved");
  })
  .catch((err: unknown) => {
    showQueueError(err);
  })
  .finally(() => {
    processingShareRef.current = false;
  });
```

Add `addClip` to the existing `import { addToQueue } from "../lib/api"` line: `import { addToQueue, addClip } from "../lib/api";`

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter mobile typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/api.ts apps/mobile/app/_layout.tsx
git commit -m "mobile: accept any shared url via universal addClip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Mobile — per-type clip cards + category filter

**Files:**

- Create: `apps/mobile/components/ClipCard.tsx` (dispatcher)
- Create: `apps/mobile/components/WebCard.tsx`
- Create: `apps/mobile/components/TweetCard.tsx`
- Modify: `apps/mobile/app/(tabs)/index.tsx` (use `ClipCard`; add category filter chips)

**Interfaces:**

- Consumes: `Summary`, `TweetClipMetadata`, `WebClipMetadata`, `neon`, `brutalShadowSm`.
- Produces: `ClipCard({ item }: { item: Summary })` renders by `item.sourceType`: `youtube` → existing `QueueCard`; `web` → `WebCard`; `tweet` → `TweetCard`.

- [ ] **Step 1: Write `ClipCard` dispatcher**

Create `apps/mobile/components/ClipCard.tsx`:

```tsx
import type { Summary } from "@cliphy/shared";
import { QueueCard } from "./QueueCard";
import { WebCard } from "./WebCard";
import { TweetCard } from "./TweetCard";

export function ClipCard({ item }: { item: Summary }) {
  if (item.sourceType === "tweet") return <TweetCard item={item} />;
  if (item.sourceType === "web") return <WebCard item={item} />;
  return <QueueCard item={item} />;
}
```

- [ ] **Step 2: Write `WebCard`**

Create `apps/mobile/components/WebCard.tsx`:

```tsx
import { View, Text, Pressable, Image, Linking, useColorScheme } from "react-native";
import { useRouter } from "expo-router";
import type { Summary, WebClipMetadata } from "@cliphy/shared";
import { brutalShadowSm } from "../lib/theme";

export function WebCard({ item }: { item: Summary }) {
  const router = useRouter();
  const isDark = useColorScheme() === "dark";
  const meta = (item.sourceMetadata ?? {}) as WebClipMetadata;

  function handlePress() {
    if (meta.kind === "article") router.push(`/summary/${item.id}`);
    else if (item.sourceUrl) Linking.openURL(item.sourceUrl);
  }

  return (
    <Pressable
      onPress={handlePress}
      className="border-2 border-black dark:border-[#505050] rounded-lg p-3 bg-[#f9fafb] dark:bg-[#282828]"
      style={brutalShadowSm()}
      accessibilityRole="button"
      accessibilityLabel={item.videoTitle ?? item.sourceUrl ?? "Web clip"}
    >
      {item.heroImageUrl ? (
        <Image
          source={{ uri: item.heroImageUrl }}
          resizeMode="cover"
          className="w-full h-32 rounded-md border-2 border-black dark:border-[#505050] mb-2 bg-[#e5e7eb] dark:bg-[#1e1e1e]"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <Text
        className="text-base font-bold text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
        numberOfLines={2}
      >
        {item.videoTitle ?? item.sourceUrl}
      </Text>
      <Text
        className="text-xs text-[#6b7280] dark:text-[#9ca3af] mt-0.5"
        style={{ fontFamily: "DMSans" }}
        numberOfLines={1}
      >
        {meta.siteName ?? ""}
        {meta.readingTimeMin ? ` · ${meta.readingTimeMin} min read` : ""}
      </Text>
      {item.excerpt ? (
        <Text
          className="text-sm text-[#374151] dark:text-[#d1d5db] mt-1"
          style={{ fontFamily: "DMSans" }}
          numberOfLines={2}
        >
          {item.excerpt}
        </Text>
      ) : null}
    </Pressable>
  );
}
```

- [ ] **Step 3: Write `TweetCard`**

Create `apps/mobile/components/TweetCard.tsx`:

```tsx
import { View, Text, Pressable, Image, useColorScheme } from "react-native";
import { useRouter } from "expo-router";
import type { Summary, TweetClipMetadata } from "@cliphy/shared";
import { brutalShadowSm } from "../lib/theme";

export function TweetCard({ item }: { item: Summary }) {
  const router = useRouter();
  const meta = (item.sourceMetadata ?? {}) as TweetClipMetadata;
  const threadCount = meta.threadTweetIds?.length ?? 1;

  return (
    <Pressable
      onPress={() => router.push(`/summary/${item.id}`)}
      className="border-2 border-black dark:border-[#505050] rounded-lg p-3 bg-[#f9fafb] dark:bg-[#282828]"
      style={brutalShadowSm()}
      accessibilityRole="button"
      accessibilityLabel={`Tweet by ${meta.handle}`}
    >
      <View className="flex-row items-center gap-2 mb-1">
        {meta.avatarUrl ? (
          <Image
            source={{ uri: meta.avatarUrl }}
            className="w-8 h-8 rounded-full border border-black dark:border-[#505050]"
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <Text
          className="text-sm font-bold text-[#111827] dark:text-white"
          style={{ fontFamily: "DMSans" }}
          numberOfLines={1}
        >
          @{meta.handle}
        </Text>
        {threadCount > 1 ? (
          <Text
            className="text-xs text-[#6b7280] dark:text-[#9ca3af]"
            style={{ fontFamily: "DMSans" }}
          >
            🧵 {threadCount}
          </Text>
        ) : null}
      </View>
      <Text
        className="text-sm text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
        numberOfLines={5}
      >
        {item.content}
      </Text>
      {meta.media && meta.media.length > 0 && meta.media[0].previewUrl ? (
        <Image
          source={{ uri: meta.media[0].previewUrl }}
          resizeMode="cover"
          className="w-full h-40 rounded-md border-2 border-black dark:border-[#505050] mt-2 bg-[#e5e7eb] dark:bg-[#1e1e1e]"
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </Pressable>
  );
}
```

- [ ] **Step 4: Swap the list to `ClipCard` + add category chips**

In `apps/mobile/app/(tabs)/index.tsx`: replace the `QueueCard` import and its usage in the `FlatList` `renderItem` with `ClipCard`. Add a horizontal row of filter chips above the list for `CLIP_CATEGORIES` values (`idea | reading | design | reference`) plus an "All" chip; keep a `selectedCategory` state and filter the list client-side by `item.category`. Follow the existing tag-filter chip styling already present in that screen (reuse the same chip classNames).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter mobile typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/components/ClipCard.tsx apps/mobile/components/WebCard.tsx apps/mobile/components/TweetCard.tsx "apps/mobile/app/(tabs)/index.tsx"
git commit -m "mobile: per-type clip cards and category filter in inbox

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Smoke tests, thread stitching, ADR + devlog

**Files:**

- Create: `apps/server/scripts/smoke-test-clips.test.ts`
- Modify: `apps/server/src/services/extractors/tweet.ts` (finalize self-thread stitching against live shape)
- Create: `docs/decisions/00XX-tweet-fetching-approach.md`
- Create: `docs/devlog/2026-09-05-universal-clip-capture.md`

- [ ] **Step 1: Live smoke test (opt-in)**

Create `apps/server/scripts/smoke-test-clips.test.ts` that (guarded by env like the existing smoke test) calls `extractWebClip` on a real article URL and `extractTweetClip` on a real tweet + a known self-thread, asserting non-empty `content`/`text` and that the thread returns `threadTweetIds.length > 1`.
Run: `pnpm vitest run apps/server/scripts/smoke-test-clips.test.ts`
Expected: PASS against live endpoints (or SKIP when env is unset).

- [ ] **Step 2: Finalize self-thread stitching**

Using the live syndication payload shape observed in Step 1, implement walk-the-chain stitching in `extractTweetClip`: when the root tweet has author-continuous replies, append their text (in publish order) into `text`, collect ids into `threadTweetIds`, and set `threadTruncated` if the walk hit a fetch error. Re-run the Task 5 unit tests to confirm no regression: `pnpm vitest run apps/server/src/services/extractors/__tests__/tweet.test.ts`.

- [ ] **Step 3: Write the ADR**

Create `docs/decisions/00XX-tweet-fetching-approach.md` (read `docs/.lore/types/decision.schema.yaml` first for structure) documenting: chosen syndication API + FixTweet fallback + screenshot-OCR (phase #2) as the last resort; why the paid X API was rejected; the fragility risk and the fallback chain that mitigates it.

- [ ] **Step 4: Write the devlog + update backlog**

Create `docs/devlog/2026-09-05-universal-clip-capture.md` (read `docs/.lore/types/devlog.schema.yaml` first) summarizing what shipped, decisions, and follow-ups (screenshot/OCR = subproject #2, inbox redesign = #4). Add a `docs/BACKLOG.md` line for full multi-author thread capture if still wanted.

- [ ] **Step 5: Commit**

```bash
git add apps/server/scripts/smoke-test-clips.test.ts apps/server/src/services/extractors/tweet.ts docs/decisions docs/devlog docs/BACKLOG.md
git commit -m "add clip smoke tests, finalize thread stitching, log decisions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

- Universal ingest / type detection → Tasks 3, 7 ✓
- Web article/visual auto-detect → Task 4 ✓
- First-class tweets + self-thread stitching → Tasks 5, 11 ✓
- Shared AI enrichment (summary/tags/category) → Tasks 6, 8 ✓
- Data model (source_type=web, category/hero_image_url/excerpt, per-type metadata) → Tasks 1, 2 ✓
- Capture surfaces (share sheet any URL) → Task 9 ✓
- Display (web + tweet cards, category filter) → Task 10 ✓
- Error handling (failed clip saved, proxy-on-block) → Tasks 4, 7 ✓
- Testing (unit + smoke) → every task + Task 11 ✓

**Placeholder scan:** No "TBD/handle edge cases" left. The two intentionally deferred-to-live-shape items (thread stitching finalization, exact Anthropic model constant) are explicit steps with concrete verification (Tasks 11.2, 6.3), not vague hand-waves.

**Type consistency:** `WebClip`/`TweetClip` extractor return types (T4/T5) are consumed field-for-field in the T7 insert payload. `Enrichment.category: ClipCategory` (T6) matches `Summary.category` (T1) and the `category` DB column (T2). `addClip` returns `{ clip: Summary }` (T9) consumed by cards (T10). `clip/embed.requested` event name consistent across T7 fire and T8 worker.
