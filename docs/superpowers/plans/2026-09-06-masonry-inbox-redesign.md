# Masonry Inbox Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the single-column inbox with a pure-JS two-column masonry feed of polished per-type cards, OTA-shippable.

**Architecture:** `lib/masonry.ts` provides `heightEstimate` + `splitColumns`; `components/MasonryFeed.tsx` renders two balanced columns of `ClipCard`s; the inbox swaps its `FlatList` for a `ScrollView` + `MasonryFeed`. Search/filter/refresh preserved.

**Tech Stack:** React Native + Expo, NativeWind, Vitest v4 (`pnpm vitest run <path>`).

## Global Constraints

- Mobile imports are extensionless. Suites tag Allure in `beforeEach` (`layer/epic/feature` from `allure-js-commons`).
- No server/type changes; `MasonryFeed` consumes the existing `Summary[]`.
- Commit messages imperative, end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `lib/masonry.ts` — height estimate + column split

**Files:**

- Create: `apps/mobile/lib/masonry.ts`
- Test: `apps/mobile/lib/__tests__/masonry.test.ts`

**Interfaces:**

- Produces: `heightEstimate(clip: Summary): number`; `splitColumns(items: Summary[]): [Summary[], Summary[]]`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/lib/__tests__/masonry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { Summary } from "@cliphy/shared";
import { heightEstimate, splitColumns } from "../masonry";

function clip(p: Partial<Summary>): Summary {
  return {
    id: Math.random().toString(36),
    userId: "u",
    sourceType: "web",
    status: "completed",
    tags: [],
    createdAt: "t",
    updatedAt: "t",
    ...p,
  } as Summary;
}

describe("masonry", () => {
  beforeEach(() => {
    layer("unit");
    epic("Inbox");
    feature("Masonry");
  });

  it("estimates image and tweet-with-media taller than a bare link", () => {
    const link = heightEstimate(clip({ sourceType: "web" }));
    const image = heightEstimate(clip({ sourceType: "image", heroImageUrl: "x" }));
    const tweet = heightEstimate(
      clip({ sourceType: "tweet", sourceMetadata: { media: [{ type: "photo", url: "x" }] } }),
    );
    expect(image).toBeGreaterThan(link);
    expect(tweet).toBeGreaterThan(link);
  });

  it("splits into two columns preserving per-column order and balancing", () => {
    const tall = clip({ sourceType: "image", heroImageUrl: "x" });
    const s1 = clip({ sourceType: "web" });
    const s2 = clip({ sourceType: "web" });
    const s3 = clip({ sourceType: "web" });
    const [a, b] = splitColumns([tall, s1, s2, s3]);
    expect(a.length + b.length).toBe(4);
    // the tall item takes column A; the three shorts stack in column B
    expect(a[0].id).toBe(tall.id);
    expect(b.map((c) => c.id)).toEqual([s1.id, s2.id, s3.id]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm vitest run apps/mobile/lib/__tests__/masonry.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `apps/mobile/lib/masonry.ts`:

```typescript
import type { Summary } from "@cliphy/shared";

// Rough relative card heights used only to balance the two columns. Units are
// arbitrary "estimated points"; only the ratios matter.
export function heightEstimate(clip: Summary): number {
  const base = 90; // frame + title + meta
  const meta = (clip.sourceMetadata ?? {}) as { media?: unknown[]; kind?: string };
  switch (clip.sourceType) {
    case "image":
      return base + (clip.heroImageUrl ? 220 : 40);
    case "tweet":
      return base + (Array.isArray(meta.media) && meta.media.length ? 200 : 40);
    case "web":
      return base + (clip.heroImageUrl ? 150 : 0) + (clip.excerpt ? 30 : 0);
    case "youtube":
      return base + 80; // thumbnail
    case "podcast":
      return base + (clip.excerpt ? 30 : 0);
    default:
      return base;
  }
}

// Greedy shortest-column bin-packing. Each item joins whichever column currently
// has the smaller running estimated height, preserving feed order within a column.
export function splitColumns(items: Summary[]): [Summary[], Summary[]] {
  const cols: [Summary[], Summary[]] = [[], []];
  const heights = [0, 0];
  for (const item of items) {
    const target = heights[0] <= heights[1] ? 0 : 1;
    cols[target].push(item);
    heights[target] += heightEstimate(item);
  }
  return cols;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run apps/mobile/lib/__tests__/masonry.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/masonry.ts apps/mobile/lib/__tests__/masonry.test.ts
git commit -m "add masonry height estimate and two-column split

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `MasonryFeed` component

**Files:**

- Create: `apps/mobile/components/MasonryFeed.tsx`

**Interfaces:**

- Consumes: `splitColumns` (Task 1), `ClipCard`.
- Produces: `MasonryFeed({ items }: { items: Summary[] })`.

- [ ] **Step 1: Implement**

Create `apps/mobile/components/MasonryFeed.tsx`:

```tsx
import { View } from "react-native";
import type { Summary } from "@cliphy/shared";
import { splitColumns } from "../lib/masonry";
import { ClipCard } from "./ClipCard";

export function MasonryFeed({ items }: { items: Summary[] }) {
  const [colA, colB] = splitColumns(items);
  return (
    <View className="flex-row gap-3 px-4 py-4">
      <View className="flex-1 gap-3">
        {colA.map((c) => (
          <ClipCard key={c.id} item={c} />
        ))}
      </View>
      <View className="flex-1 gap-3">
        {colB.map((c) => (
          <ClipCard key={c.id} item={c} />
        ))}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter mobile typecheck` → no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/MasonryFeed.tsx
git commit -m "add MasonryFeed two-column layout component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Card polish for masonry

**Files:**

- Modify: `apps/mobile/components/WebCard.tsx`, `TweetCard.tsx`, `ImageCard.tsx`, `QueueCard.tsx`

**Interfaces:** cards remain `({ item }: { item: Summary })`; only styling changes.

- [ ] **Step 1: Remove fixed heights so cards size to content**

- `WebCard.tsx`: change the hero `Image` class `h-32` → `aspect-[16/10]` (or `aspect-video`), keep `w-full`.
- `TweetCard.tsx`: change the media `Image` `h-40` → `aspect-[4/3]`.
- `ImageCard.tsx`: change the hero `Image` `h-40` → `aspect-[3/4]` (portrait screenshots read taller).
- `QueueCard.tsx`: replace the fixed `w-28 h-16` side thumbnail with a full-width top thumbnail: move the `Image` above the text, class `w-full aspect-video rounded-md border-2 border-black dark:border-[#505050] mb-2`, and change the outer layout from `flex-row` to a column. Keep the status dot.

- [ ] **Step 2: Add a category kicker + source glyph (WebCard, ImageCard, TweetCard, QueueCard)**

At the top of each card's text area, when `item.category` is set, render a small uppercase chip in the category color. Add a source glyph to the meta line: `▶` (youtube), `🔗` (web), `🐦` (tweet), `🎧` (podcast), `🖼` (image). Use a shared helper — create `apps/mobile/lib/clipGlyph.ts`:

```typescript
import type { SourceType } from "@cliphy/shared";
export function sourceGlyph(t: SourceType): string {
  return { youtube: "▶", web: "🔗", tweet: "🐦", podcast: "🎧", image: "🖼" }[t] ?? "";
}
```

Prefix the meta text with `` `${sourceGlyph(item.sourceType)} ` `` in each card's meta line.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter mobile typecheck` → no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/components/WebCard.tsx apps/mobile/components/TweetCard.tsx apps/mobile/components/ImageCard.tsx apps/mobile/components/QueueCard.tsx apps/mobile/lib/clipGlyph.ts
git commit -m "polish clip cards for masonry: content-height images, source glyphs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Swap the inbox to masonry

**Files:**

- Modify: `apps/mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Replace the FlatList with ScrollView + MasonryFeed**

In the non-loading/non-error branch, replace the `<FlatList data={listData} ... />` with:

```tsx
<ScrollView
  refreshControl={
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={neon[600]} />
  }
>
  {listData.length === 0 ? <EmptyState /> : <MasonryFeed items={listData} />}
</ScrollView>
```

Keep the category-chip row (still gated by `searchResults === null`) above the ScrollView. Add `ScrollView` to the `react-native` import; add `import { MasonryFeed } from "../../components/MasonryFeed";`. Remove the now-unused `FlatList` import and the `renderItem`/`ClipCard` direct usage if no longer referenced (keep `ClipCard` import only if still used — it isn't after this, so remove it).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter mobile typecheck` → no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/app/(tabs)/index.tsx"
git commit -m "swap inbox to two-column masonry feed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Docs

**Files:**

- Create: `docs/decisions/0046-pure-js-masonry-inbox.md`
- Create: `docs/devlog/2026-09-06-masonry-inbox-redesign.md`

- [ ] **Step 1: ADR + devlog**

`0046`: pure-JS two-column masonry (bin-packed) over a native library — OTA-shippable, no rebuild, fine at personal scale; FlashList masonry deferred. Devlog: what shipped + that this completes the 4-part clipping-platform pivot.

- [ ] **Step 2: Commit**

```bash
git add docs/decisions docs/devlog
git commit -m "document masonry inbox decision and session

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- Masonry split + estimate → Task 1 ✓; component → Task 2 ✓; card polish → Task 3 ✓; inbox swap → Task 4 ✓; docs → Task 5 ✓.
- No placeholders; each edit names a concrete anchor.
- Types: `splitColumns`/`heightEstimate` (Task 1) consumed by `MasonryFeed` (Task 2), consumed by the inbox (Task 4). `sourceGlyph(SourceType)` (Task 3) used in cards. No server/shared changes.
- Risk: NativeWind `aspect-[16/10]` arbitrary values must be supported — if not, fall back to `style={{ aspectRatio: 16/10 }}`. Verified pattern: use the `style` aspectRatio form to be safe across NativeWind versions.
