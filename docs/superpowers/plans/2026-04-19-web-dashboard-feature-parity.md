# Web Dashboard Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port all features from the extension's Cliphub page into the web app dashboard and summary page, move two shared UI components to `packages/shared`, and rename the dashboard to "Your Cliphub".

**Architecture:** Move `TagSuggestions` and `SelectionActionBar` to `packages/shared/src/components/` (extend shared with React peer dep + JSX tsconfig). Rewrite `apps/web/src/pages/Dashboard.tsx` using the extension's summaries page as reference — same sub-component pattern (`Header`, `Toolbar`, `CardList`, `SummaryCard`). Upgrade `SummaryPage` with tag editing, retry, and auto-tag.

**Tech Stack:** React 18, TypeScript strict, Tailwind v4, React Router v7, Vitest, pnpm workspaces

---

## File Structure

| Action  | File                                                    | Responsibility                                                 |
| ------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| Modify  | `packages/shared/package.json`                          | Add react peer dep                                             |
| Modify  | `packages/shared/tsconfig.json`                         | Add jsx: react-jsx                                             |
| Move →  | `packages/shared/src/components/TagSuggestions.tsx`     | Shared tag suggestion chip panel                               |
| Move →  | `packages/shared/src/components/SelectionActionBar.tsx` | Shared sticky bulk-action bar                                  |
| Modify  | `packages/shared/src/index.ts`                          | Export new components                                          |
| Modify  | `apps/extension/entrypoints/summaries/App.tsx`          | Update import paths only                                       |
| Delete  | `apps/extension/components/TagSuggestions.tsx`          | Moved to shared                                                |
| Delete  | `apps/extension/components/SelectionActionBar.tsx`      | Moved to shared                                                |
| Modify  | `apps/web/src/lib/api.ts`                               | Add getAllTags, updateSummaryTags, autoTagBulk, autoTagSummary |
| Rewrite | `apps/web/src/pages/Dashboard.tsx`                      | Full dashboard with all features                               |
| Modify  | `apps/web/src/pages/SummaryPage.tsx`                    | Tag editing, retry, auto-tag                                   |

---

## Chunk 1: Shared Package — React Support + Move Components

### Task 1: Add React JSX support to `packages/shared`

**Files:**

- Modify: `packages/shared/package.json`
- Modify: `packages/shared/tsconfig.json`

- [ ] **Step 1: Add react peer dep and @types/react dev dep**

In `packages/shared/package.json`, add:

```json
{
  "name": "@cliphy/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "^18"
  },
  "devDependencies": {
    "@types/react": "^18",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Add JSX compiler options**

In `packages/shared/tsconfig.json`, add jsx settings:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install types**

```bash
pnpm --filter @cliphy/shared add -D @types/react
```

Expected: `@types/react` added to `packages/shared/package.json` devDependencies.

- [ ] **Step 4: Verify typecheck still passes**

```bash
pnpm --filter @cliphy/shared typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/package.json packages/shared/tsconfig.json
git commit -m "add React JSX support to shared package"
```

---

### Task 2: Move TagSuggestions to shared

**Files:**

- Create: `packages/shared/src/components/TagSuggestions.tsx`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create components directory and add TagSuggestions**

Create `packages/shared/src/components/TagSuggestions.tsx` with the exact content from `apps/extension/components/TagSuggestions.tsx` (no changes to the component itself):

```tsx
import { useState } from "react";

interface TagSuggestionsProps {
  existing: string[];
  new: string[];
  currentTags: string[];
  onApplyOne: (tag: string) => void;
  onApply: (tags: string[]) => void;
  onDismiss: () => void;
}

interface Chip {
  tag: string;
  isNew: boolean;
}

export function TagSuggestions({
  existing,
  new: newTags,
  currentTags,
  onApplyOne,
  onApply,
  onDismiss,
}: TagSuggestionsProps) {
  const [chips, setChips] = useState<Chip[]>(() => {
    const existingChips = existing
      .filter((t) => !currentTags.includes(t))
      .map((tag) => ({ tag, isNew: false }));
    const existingTagSet = new Set(existingChips.map((c) => c.tag));
    const newChips = newTags
      .filter((t) => !existingTagSet.has(t))
      .map((tag) => ({ tag, isNew: true }));
    return [...existingChips, ...newChips];
  });

  if (chips.length === 0) return null;

  function handleChipClick(tag: string) {
    setChips((prev) => prev.filter((c) => c.tag !== tag));
    onApplyOne(tag);
  }

  function handleAddAll() {
    const tags = chips.map((c) => c.tag);
    setChips([]);
    onApply(tags);
  }

  return (
    <div className="mt-2 border-t border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-1 flex items-center gap-1 flex-wrap">
      <span className="text-[10px] text-green-700 dark:text-green-400 font-bold mr-1 shrink-0">
        ✨ Add tags:
      </span>
      {chips.map(({ tag, isNew }) =>
        isNew ? (
          <button
            key={tag}
            onClick={() => handleChipClick(tag)}
            className="px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer border bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
          >
            {tag}
            <span className="ml-1 text-[8px] font-black opacity-70">new</span>
          </button>
        ) : (
          <button
            key={tag}
            onClick={() => handleChipClick(tag)}
            className="px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer border bg-white dark:bg-transparent border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
          >
            {tag}
          </button>
        ),
      )}
      <button
        onClick={handleAddAll}
        className="ml-auto text-[10px] font-bold text-green-700 dark:text-green-400 hover:text-green-900 dark:hover:text-green-200 bg-transparent border-0 p-0 cursor-pointer shrink-0 transition-colors"
      >
        Add all
      </button>
      <button
        onClick={onDismiss}
        className="text-[10px] text-(--color-text-faint) hover:text-(--color-text-muted) bg-transparent border-0 p-0 cursor-pointer shrink-0"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Export from shared index**

Add to `packages/shared/src/index.ts`:

```ts
export * from "./types";
export * from "./constants";
export * from "./messages";
export * from "./utils";
export * from "./tokens";
export * from "./components/TagSuggestions";
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @cliphy/shared typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/components/TagSuggestions.tsx packages/shared/src/index.ts
git commit -m "move TagSuggestions component to shared package"
```

---

### Task 3: Move SelectionActionBar to shared

**Files:**

- Create: `packages/shared/src/components/SelectionActionBar.tsx`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create SelectionActionBar in shared**

Create `packages/shared/src/components/SelectionActionBar.tsx`:

```tsx
interface SelectionActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onAutoTag: () => void;
  onDelete: () => void;
  loading?: boolean;
}

export function SelectionActionBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClear,
  onAutoTag,
  onDelete,
  loading,
}: SelectionActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 mx-auto max-w-2xl bg-white dark:bg-(--color-surface-raised) border-2 border-(--color-border-hard) rounded-xl px-4 py-3 shadow-brutal-sm flex items-center justify-between z-50">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-bold text-(--color-text)">{selectedCount} selected</span>
        {selectedCount < totalCount && (
          <button
            onClick={onSelectAll}
            className="text-neon-600 hover:text-neon-700 dark:text-neon-400 dark:hover:text-neon-300 bg-transparent border-0 p-0 cursor-pointer text-sm"
          >
            Select all
          </button>
        )}
        <button
          onClick={onClear}
          className="text-(--color-text-muted) hover:text-(--color-text) bg-transparent border-0 p-0 cursor-pointer text-sm"
        >
          Clear
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onAutoTag}
          disabled={loading}
          className="bg-neon-100 dark:bg-neon-900/50 hover:bg-neon-200 dark:hover:bg-neon-900/70 text-(--color-text) px-4 py-1.5 rounded-lg text-sm font-bold border-2 border-(--color-border-hard) shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Tagging..." : "✨ Auto-tag"}
        </button>
        <button
          onClick={onDelete}
          className="bg-red-100 dark:bg-red-950/30 hover:bg-red-200 dark:hover:bg-red-950/50 text-red-700 dark:text-red-400 px-4 py-1.5 rounded-lg text-sm font-bold border-2 border-(--color-border-hard) shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export from shared index**

Update `packages/shared/src/index.ts`:

```ts
export * from "./types";
export * from "./constants";
export * from "./messages";
export * from "./utils";
export * from "./tokens";
export * from "./components/TagSuggestions";
export * from "./components/SelectionActionBar";
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @cliphy/shared typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/components/SelectionActionBar.tsx packages/shared/src/index.ts
git commit -m "move SelectionActionBar component to shared package"
```

---

### Task 4: Update extension imports, delete old files

**Files:**

- Modify: `apps/extension/entrypoints/summaries/App.tsx`
- Delete: `apps/extension/components/TagSuggestions.tsx`
- Delete: `apps/extension/components/SelectionActionBar.tsx`

- [ ] **Step 1: Update import paths in extension summaries App.tsx**

In `apps/extension/entrypoints/summaries/App.tsx`, change lines 10–13:

```ts
// Before:
import { SelectionActionBar } from "../../components/SelectionActionBar";
import { TagSuggestions } from "../../components/TagSuggestions";

// After:
import { SelectionActionBar, TagSuggestions } from "@cliphy/shared";
```

- [ ] **Step 2: Delete old extension component files**

```bash
rm apps/extension/components/TagSuggestions.tsx
rm apps/extension/components/SelectionActionBar.tsx
```

- [ ] **Step 3: Typecheck extension**

```bash
pnpm --filter extension typecheck 2>/dev/null || pnpm --filter cliphy-extension typecheck 2>/dev/null || pnpm -C apps/extension exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Build extension to verify**

```bash
pnpm --filter extension build 2>/dev/null || pnpm build:extension
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/summaries/App.tsx
git rm apps/extension/components/TagSuggestions.tsx apps/extension/components/SelectionActionBar.tsx
git commit -m "update extension to import TagSuggestions and SelectionActionBar from shared"
```

---

## Chunk 2: Web API

### Task 5: Add missing API functions to web app

**Files:**

- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add imports for new types at top of api.ts**

At the top of `apps/web/src/lib/api.ts`, add to the existing `@cliphy/shared` import:

```ts
import type {
  QueueAddRequest,
  QueueAddResponse,
  SummaryResponse,
  UsageResponse,
  Summary,
  ChatMessage,
  ChatResponse,
  TagsResponse,
  AutoTagSuggestion,
  BulkAutoTagResponse,
} from "@cliphy/shared";
```

- [ ] **Step 2: Add four new functions after `deleteSummary`**

Add to `apps/web/src/lib/api.ts` after the `deleteSummary` function:

```ts
export async function updateSummaryTags(id: string, tags: string[]) {
  return request<TagsResponse>(API_ROUTES.SUMMARIES.TAGS(id), {
    method: "PATCH",
    body: JSON.stringify({ tags }),
  });
}

export async function getAllTags() {
  return request<TagsResponse>(API_ROUTES.TAGS.LIST);
}

export async function autoTagSummary(id: string) {
  return request<AutoTagSuggestion>(API_ROUTES.SUMMARIES.AUTO_TAG(id), {
    method: "POST",
  });
}

export async function autoTagBulk(summaryIds: string[]) {
  return request<BulkAutoTagResponse>(API_ROUTES.SUMMARIES.AUTO_TAG_BULK, {
    method: "POST",
    body: JSON.stringify({ summaryIds }),
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm -C apps/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "add getAllTags, updateSummaryTags, autoTagBulk, autoTagSummary to web API"
```

---

## Chunk 3: Web Dashboard Rewrite

### Task 6: Rewrite Dashboard — skeleton with Header, Toolbar, basic CardList

**Files:**

- Rewrite: `apps/web/src/pages/Dashboard.tsx`

This task replaces the simple Dashboard with the full-featured version. Subsequent tasks wire up tag editing, selection, and auto-tag. Start with the structural shell.

- [ ] **Step 1: Write the new Dashboard.tsx**

Replace the entire contents of `apps/web/src/pages/Dashboard.tsx`:

```tsx
import type { AutoTagSuggestion, Summary, UsageInfo } from "@cliphy/shared";
import {
  FREE_HISTORY_DAYS,
  SelectionActionBar,
  TagSuggestions,
  formatTimeSaved,
  relativeDate,
} from "@cliphy/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Nav } from "../components/Nav";
import { UsageBar } from "../components/UsageBar";
import * as api from "../lib/api";

type SortOrder = "newest" | "oldest";

export function Dashboard() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoTagResults, setAutoTagResults] = useState<Map<string, AutoTagSuggestion>>(new Map());
  const [bulkAutoTagLoading, setBulkAutoTagLoading] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const [queueRes, summariesRes, usageRes] = await Promise.all([
        api.getQueue(),
        api.getSummaries(),
        api.getUsage(),
      ]);

      const all = new Map<string, Summary>();
      for (const s of queueRes.items) all.set(s.id, s);
      for (const s of summariesRes.summaries) all.set(s.id, s);
      const merged = Array.from(all.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      setSummaries(merged);
      setUsage(usageRes.usage);

      try {
        const tagsRes = await api.getAllTags();
        setAllTags(tagsRes.tags);
      } catch {
        // non-fatal
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function handleTagsChange(summaryId: string, newTags: string[]) {
    const rollback = summaries.find((s) => s.id === summaryId)?.tags;
    setSummaries((prev) => {
      const updated = prev.map((s) => (s.id === summaryId ? { ...s, tags: newTags } : s));
      const all = new Set<string>();
      for (const s of updated) for (const t of s.tags) all.add(t);
      setAllTags([...all].sort());
      if (filterTag && !all.has(filterTag)) setFilterTag(null);
      return updated;
    });
    try {
      const [res] = await Promise.all([
        api.updateSummaryTags(summaryId, newTags),
        api.getAllTags().then((r) => setAllTags(r.tags)),
      ]);
      setSummaries((prev) => prev.map((s) => (s.id === summaryId ? { ...s, tags: res.tags } : s)));
    } catch {
      if (rollback !== undefined) {
        setSummaries((prev) =>
          prev.map((s) => (s.id === summaryId ? { ...s, tags: rollback } : s)),
        );
      }
      const tagsRes = await api.getAllTags().catch(() => null);
      if (tagsRes) setAllTags(tagsRes.tags);
    }
  }

  async function handleDelete(id: string) {
    const prev = summaries;
    setSummaries((s) => s.filter((x) => x.id !== id));
    try {
      await api.deleteSummary(id);
    } catch {
      setSummaries(prev);
    }
  }

  const isPro = usage?.plan === "pro";
  const hasSelection = selectedIds.size > 0;

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(displayedSummaries.map((s) => s.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function handleAutoTagDismiss(summaryId: string) {
    setAutoTagResults((prev) => {
      const next = new Map(prev);
      next.delete(summaryId);
      return next;
    });
  }

  function handleAutoTagApplyOne(summaryId: string, tag: string) {
    const summary = summaries.find((s) => s.id === summaryId);
    if (!summary) return;
    handleTagsChange(summaryId, [...summary.tags, tag]);
    setAutoTagResults((prev) => {
      const next = new Map(prev);
      const result = prev.get(summaryId);
      if (!result) return prev;
      const remaining = {
        existing: result.existing.filter((t) => t !== tag),
        new: result.new.filter((t) => t !== tag),
      };
      if (remaining.existing.length === 0 && remaining.new.length === 0) {
        next.delete(summaryId);
      } else {
        next.set(summaryId, remaining);
      }
      return next;
    });
  }

  function handleAutoTagApplyAll(summaryId: string, tags: string[]) {
    const summary = summaries.find((s) => s.id === summaryId);
    if (!summary) return;
    handleTagsChange(summaryId, [...summary.tags, ...tags]);
    setAutoTagResults((prev) => {
      const next = new Map(prev);
      next.delete(summaryId);
      return next;
    });
  }

  async function handleBulkAutoTag() {
    const ids = [...selectedIds];
    setBulkAutoTagLoading(true);
    try {
      const response = await api.autoTagBulk(ids);
      const newResults = new Map(autoTagResults);
      for (const s of response.suggestions) {
        if (!s.skipped && s.existing && s.new) {
          newResults.set(s.summaryId, { existing: s.existing, new: s.new });
        }
      }
      setAutoTagResults(newResults);
      clearSelection();
    } catch (err) {
      console.error("Bulk auto-tag failed:", err);
    } finally {
      setBulkAutoTagLoading(false);
    }
  }

  async function handleApplyAllAutoTags() {
    for (const [summaryId, result] of autoTagResults) {
      const summary = summaries.find((s) => s.id === summaryId);
      if (!summary) continue;
      const merged = [
        ...summary.tags,
        ...result.existing.filter((t) => !summary.tags.includes(t)),
        ...result.new.filter((t) => !summary.tags.includes(t)),
      ];
      await handleTagsChange(summaryId, merged);
    }
    setAutoTagResults(new Map());
  }

  function handleDismissAllAutoTags() {
    setAutoTagResults(new Map());
  }

  async function handleBulkDelete() {
    for (const id of [...selectedIds]) {
      await handleDelete(id);
    }
    clearSelection();
  }

  async function handleUpgrade() {
    setUpgradeLoading(true);
    try {
      const { url } = await api.createCheckout();
      window.location.href = url;
    } catch {
      setUpgradeLoading(false);
    }
  }

  const hasFilters = searchQuery !== "" || filterTag !== null;

  function clearFilters() {
    setSearchQuery("");
    setFilterTag(null);
  }

  const displayedSummaries = useMemo(() => {
    let result = summaries;
    if (filterTag) result = result.filter((s) => s.tags.includes(filterTag));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          (s.videoTitle ?? "").toLowerCase().includes(q) ||
          (s.videoChannel ?? "").toLowerCase().includes(q),
      );
    }
    if (sortOrder === "oldest") result = [...result].reverse();
    return result;
  }, [summaries, searchQuery, sortOrder, filterTag]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6">
        <Nav />
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-3 border-neon-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6">
        <Nav />
        <div className="text-center py-16">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              load();
            }}
            className="mt-4 text-sm font-bold px-4 py-2 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 pb-24">
      <Nav />

      <DashboardHeader
        allTags={allTags}
        filterTag={filterTag}
        onFilterTag={setFilterTag}
        onClearAll={clearFilters}
      />

      {usage && (
        <div className="mb-4">
          <UsageBar usage={usage} onUpgrade={handleUpgrade} upgradeLoading={upgradeLoading} />
        </div>
      )}

      <Toolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortOrder={sortOrder}
        onSortChange={setSortOrder}
      />

      <CardList
        summaries={displayedSummaries}
        totalCount={summaries.length}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
        filterTag={filterTag}
        onFilterTag={setFilterTag}
        onDelete={handleDelete}
        allTags={allTags}
        onTagsChange={handleTagsChange}
        hasSelection={hasSelection}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelection}
        isPro={isPro}
        autoTagResults={autoTagResults}
        onAutoTagApplyOne={handleAutoTagApplyOne}
        onAutoTagApplyAll={handleAutoTagApplyAll}
        onAutoTagDismiss={handleAutoTagDismiss}
      />

      {autoTagResults.size > 0 && (
        <div className="sticky bottom-20 mx-auto max-w-2xl bg-white dark:bg-(--color-surface-raised) border-2 border-(--color-border-hard) rounded-xl px-4 py-3 shadow-brutal-sm flex items-center justify-between z-10 mb-2">
          <span className="text-sm text-(--color-text)">
            ✨ {autoTagResults.size} {autoTagResults.size === 1 ? "summary has" : "summaries have"}{" "}
            pending tag suggestions
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleDismissAllAutoTags}
              className="text-sm font-bold text-(--color-text-muted) hover:text-(--color-text) bg-transparent border-0 px-2 py-1 cursor-pointer transition-colors"
            >
              Dismiss all
            </button>
            <button
              onClick={handleApplyAllAutoTags}
              className="text-sm font-bold bg-neon-100 dark:bg-neon-900/50 hover:bg-neon-200 dark:hover:bg-neon-900/70 text-(--color-text) px-4 py-1.5 rounded-lg border-2 border-(--color-border-hard) shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all"
            >
              Apply all
            </button>
          </div>
        </div>
      )}

      {isPro && (
        <SelectionActionBar
          selectedCount={selectedIds.size}
          totalCount={displayedSummaries.length}
          onSelectAll={selectAll}
          onClear={clearSelection}
          onAutoTag={handleBulkAutoTag}
          onDelete={handleBulkDelete}
          loading={bulkAutoTagLoading}
        />
      )}

      {usage?.plan === "free" && (
        <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-(--color-text-muted) bg-(--color-warn-surface) border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-1.5">
          <span>
            Showing last {FREE_HISTORY_DAYS} days.{" "}
            <button
              onClick={handleUpgrade}
              className="text-amber-600 hover:text-amber-800 font-bold bg-transparent border-0 p-0 cursor-pointer transition-colors"
            >
              Upgrade to Pro
            </button>{" "}
            for unlimited history, ✨ AI auto-tagging, and more.
          </span>
        </div>
      )}
    </div>
  );
}

function DashboardHeader({
  allTags,
  filterTag,
  onFilterTag,
  onClearAll,
}: {
  allTags: string[];
  filterTag: string | null;
  onFilterTag: (tag: string | null) => void;
  onClearAll: () => void;
}) {
  const hasActiveFilter = !!filterTag;
  return (
    <div className="mb-4 pt-2">
      <h1
        onClick={hasActiveFilter ? onClearAll : undefined}
        className={`text-2xl font-extrabold m-0 ${hasActiveFilter ? "cursor-pointer hover:text-neon-600 transition-colors" : ""}`}
      >
        Your Cliphub
      </h1>
      {allTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => onFilterTag(filterTag === tag ? null : tag)}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-2 cursor-pointer transition-all ${
                filterTag === tag
                  ? "bg-(--color-surface) text-neon-600 border-neon-400 dark:text-neon-300 dark:border-neon-600 shadow-none translate-x-[2px] translate-y-[2px]"
                  : "bg-(--color-surface) text-(--color-text-secondary) border-(--color-border-hard) shadow-brutal-sm hover:shadow-brutal-pressed press-down hover:border-neon-300 hover:text-neon-600"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toolbar({
  searchQuery,
  onSearchChange,
  sortOrder,
  onSortChange,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortOrder: SortOrder;
  onSortChange: (s: SortOrder) => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="flex-1 relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--color-text-faint)"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search summaries..."
          className="w-full text-xs font-bold pl-8 pr-3 py-1.5 rounded-full border-2 border-(--color-border-hard) bg-(--color-surface) text-(--color-text) placeholder:text-(--color-text-faint) outline-none focus:border-neon-500 transition-colors"
        />
      </div>
      <select
        value={sortOrder}
        onChange={(e) => onSortChange(e.target.value as SortOrder)}
        className="text-xs font-bold px-3 py-1.5 rounded-full border-2 border-(--color-border-hard) bg-(--color-surface) text-(--color-text) cursor-pointer"
      >
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
      </select>
    </div>
  );
}

function CardList({
  summaries,
  totalCount,
  hasFilters,
  onClearFilters,
  filterTag,
  onFilterTag,
  onDelete,
  allTags,
  onTagsChange,
  hasSelection,
  selectedIds,
  onToggleSelect,
  isPro,
  autoTagResults,
  onAutoTagApplyOne,
  onAutoTagApplyAll,
  onAutoTagDismiss,
}: {
  summaries: Summary[];
  totalCount: number;
  hasFilters: boolean;
  onClearFilters: () => void;
  filterTag: string | null;
  onFilterTag: (tag: string | null) => void;
  onDelete: (id: string) => void;
  allTags: string[];
  onTagsChange: (id: string, tags: string[]) => Promise<void>;
  hasSelection: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  isPro: boolean;
  autoTagResults: Map<string, AutoTagSuggestion>;
  onAutoTagApplyOne: (id: string, tag: string) => void;
  onAutoTagApplyAll: (id: string, tags: string[]) => void;
  onAutoTagDismiss: (id: string) => void;
}) {
  if (totalCount === 0) {
    return (
      <div className="text-center py-16 border-2 border-(--color-border-hard) rounded-xl shadow-brutal-sm bg-(--color-surface)">
        <p className="text-3xl mb-3">🎬</p>
        <p className="text-base font-bold mb-1">No summaries yet</p>
        <p className="text-sm text-(--color-text-muted)">
          Install the Chrome extension to start queuing YouTube videos.
        </p>
      </div>
    );
  }

  if (summaries.length === 0 && hasFilters) {
    return (
      <div className="text-center py-16">
        <p className="text-sm font-bold">
          {filterTag ? `No summaries tagged "${filterTag}"` : "No summaries match your search"}
        </p>
        <button
          onClick={onClearFilters}
          className="mt-2 text-xs font-bold text-neon-600 hover:text-neon-800 bg-transparent border-0 cursor-pointer p-0 transition-colors"
        >
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {summaries.map((s) => (
        <SummaryCard
          key={s.id}
          summary={s}
          onDelete={onDelete}
          allTags={allTags}
          onTagsChange={onTagsChange}
          filterTag={filterTag}
          onFilterTag={onFilterTag}
          hasSelection={hasSelection}
          isSelected={selectedIds.has(s.id)}
          onToggleSelect={() => onToggleSelect(s.id)}
          isPro={isPro}
          autoTagResult={autoTagResults.get(s.id)}
          onAutoTagApplyOne={(tag) => onAutoTagApplyOne(s.id, tag)}
          onAutoTagApplyAll={(tags) => onAutoTagApplyAll(s.id, tags)}
          onAutoTagDismiss={() => onAutoTagDismiss(s.id)}
        />
      ))}
    </div>
  );
}

function SummaryCard({
  summary: s,
  onDelete,
  allTags,
  onTagsChange,
  filterTag,
  onFilterTag,
  hasSelection,
  isSelected,
  onToggleSelect,
  autoTagResult,
  onAutoTagApplyOne,
  onAutoTagApplyAll,
  onAutoTagDismiss,
}: {
  summary: Summary;
  onDelete: (id: string) => void;
  allTags: string[];
  onTagsChange: (id: string, tags: string[]) => Promise<void>;
  filterTag: string | null;
  onFilterTag: (tag: string | null) => void;
  hasSelection: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  isPro: boolean;
  autoTagResult?: AutoTagSuggestion;
  onAutoTagApplyOne: (tag: string) => void;
  onAutoTagApplyAll: (tags: string[]) => void;
  onAutoTagDismiss: () => void;
}) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showTagPicker) return;
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowTagPicker(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showTagPicker]);

  const isReady = s.status === "completed" && s.summaryJson;

  function handleCardClick() {
    if (hasSelection) {
      onToggleSelect();
      return;
    }
    if (isReady) navigate(`/summary/${s.id}`);
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete(s.id);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  }

  return (
    <div
      onClick={handleCardClick}
      className={`group relative w-full text-left bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg p-3 shadow-brutal-sm cursor-pointer hover:shadow-brutal-pressed press-down transition-all ${showTagPicker ? "z-10" : ""} ${isSelected ? "ring-2 ring-neon-500/50" : ""} ${hasSelection && !isSelected ? "opacity-70" : ""} ${!isReady ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-3">
        <a
          href={`https://www.youtube.com/watch?v=${s.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0"
        >
          <img
            src={`https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`}
            alt=""
            className="w-28 h-16 rounded border-2 border-(--color-border-hard) object-cover"
          />
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-(--color-text) m-0 line-clamp-1">
              {s.videoTitle || s.videoId}
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect();
              }}
              className={`w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-all shrink-0 ${
                hasSelection ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              } ${
                isSelected
                  ? "bg-neon-600 border-neon-600 text-white"
                  : "bg-transparent border-(--color-border-hard) hover:border-neon-500"
              }`}
            >
              {isSelected && <span className="text-[9px]">&#10003;</span>}
            </button>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-(--color-text-faint) mt-0.5 m-0">
            {s.videoChannel && <span>{s.videoChannel}</span>}
            {s.videoChannel && s.videoDurationSeconds != null && s.videoDurationSeconds > 0 && (
              <span>&middot;</span>
            )}
            {s.videoDurationSeconds != null && s.videoDurationSeconds > 0 && (
              <span>{formatTimeSaved(s.videoDurationSeconds)}</span>
            )}
            {(s.videoChannel || (s.videoDurationSeconds != null && s.videoDurationSeconds > 0)) && (
              <span>&middot;</span>
            )}
            <span>{relativeDate(s.createdAt)}</span>
          </div>

          {/* Status badge for non-completed */}
          {s.status !== "completed" && (
            <span
              className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full border-2 ${
                s.status === "failed"
                  ? "bg-(--color-error-surface) border-red-300 text-red-600"
                  : "bg-neon-100 border-neon-300 text-neon-700"
              }`}
            >
              {s.status === "processing" && (
                <span className="inline-block w-2 h-2 border-2 border-neon-500 border-t-transparent rounded-full animate-spin mr-1 align-middle" />
              )}
              {s.status === "pending"
                ? "Queued"
                : s.status === "processing"
                  ? "Generating..."
                  : "Failed"}
            </span>
          )}

          {/* Tags row */}
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {s.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border-2 bg-(--color-surface-raised) text-(--color-text-secondary) border-(--color-border-soft)"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterTag(filterTag === tag ? null : tag);
                  }}
                  className="bg-transparent border-0 p-0 cursor-pointer text-inherit hover:text-neon-600 transition-colors"
                >
                  {tag}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagsChange(
                      s.id,
                      s.tags.filter((t) => t !== tag),
                    ).catch(() => {});
                  }}
                  className="bg-transparent border-0 p-0 cursor-pointer text-neon-500 hover:text-red-500 transition-colors leading-none"
                  title={`Remove "${tag}"`}
                >
                  &times;
                </button>
              </span>
            ))}
            <div className="relative inline-flex" ref={pickerRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTagPicker((v) => !v);
                }}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border-2 border-(--color-border-soft) hover:border-neon-300 hover:text-neon-600 cursor-pointer transition-colors opacity-0 group-hover:opacity-100"
                title="Add tag"
              >
                + tag
              </button>
              {showTagPicker && (
                <div
                  className="absolute top-full left-0 mt-1 z-50 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm py-1 min-w-[120px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {allTags.filter((t) => !s.tags.includes(t)).length > 0 ? (
                    allTags
                      .filter((t) => !s.tags.includes(t))
                      .map((t) => (
                        <button
                          key={t}
                          onClick={() => {
                            onTagsChange(s.id, [...s.tags, t]).catch(() => {});
                            setShowTagPicker(false);
                          }}
                          className="w-full text-left text-[11px] font-bold px-3 py-1.5 bg-transparent border-0 cursor-pointer text-(--color-text-secondary) hover:bg-neon-100 hover:text-neon-600 dark:hover:bg-neon-900/30 dark:hover:text-neon-300 transition-colors"
                        >
                          {t}
                        </button>
                      ))
                  ) : (
                    <span className="block text-[11px] text-(--color-text-faint) px-3 py-1.5">
                      No more tags
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* TagSuggestions panel */}
      {autoTagResult && (
        <div onClick={(e) => e.stopPropagation()}>
          <TagSuggestions
            existing={autoTagResult.existing}
            new={autoTagResult.new}
            currentTags={s.tags}
            onApplyOne={onAutoTagApplyOne}
            onApply={onAutoTagApplyAll}
            onDismiss={onAutoTagDismiss}
          />
        </div>
      )}

      {/* Delete button */}
      <button
        onClick={handleDeleteClick}
        className={`absolute right-2 bottom-2 text-[10px] font-bold px-1.5 py-0.5 rounded border bg-transparent cursor-pointer transition-all ${autoTagResult ? "hidden" : ""} ${
          confirmDelete
            ? "border-red-400 text-red-600 opacity-100"
            : "border-transparent text-(--color-text-faint) opacity-0 group-hover:opacity-100 hover:text-red-500"
        }`}
        title="Delete summary"
      >
        {confirmDelete ? (
          "Delete?"
        ) : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -C apps/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start dev server and verify dashboard loads**

```bash
pnpm dev:prodApi
```

Open http://localhost:5173/dashboard — verify:

- Title shows "Your Cliphub"
- Summaries list with thumbnails, titles, dates
- Search and sort controls visible
- Tag filter chips appear if you have tagged summaries

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/Dashboard.tsx
git commit -m "rewrite web dashboard with full feature parity: search, sort, tags, selection, auto-tag"
```

---

## Chunk 4: SummaryPage Upgrades

### Task 7: Add tag editing to SummaryPage

**Files:**

- Modify: `apps/web/src/pages/SummaryPage.tsx`

- [ ] **Step 1: Add state and tag mutation logic**

Replace the contents of `apps/web/src/pages/SummaryPage.tsx`:

```tsx
import type { AutoTagSuggestion, Summary } from "@cliphy/shared";
import { TagSuggestions, formatTimeSaved, parseDurationToSeconds } from "@cliphy/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Nav } from "../components/Nav";
import * as api from "../lib/api";

function extractTimestamp(text: string): { time: string; seconds: number; label: string } | null {
  const match = text.match(/^[[(\s]*(\d{1,2}:\d{2}(?::\d{2})?)[)\]\s]*[-\u2013\u2014:\s]*(.*)/);
  if (!match) return null;
  const time = match[1];
  const seconds = parseDurationToSeconds(time);
  if (seconds === null) return null;
  return { time, seconds, label: match[2].trim() || time };
}

export function SummaryPage() {
  const { id } = useParams<{ id: string }>();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [autoTagResult, setAutoTagResult] = useState<AutoTagSuggestion | null>(null);
  const [autoTagLoading, setAutoTagLoading] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getSummary(id), api.getAllTags().catch(() => ({ tags: [] }))])
      .then(([res, tagsRes]) => {
        setSummary(res.summary);
        setAllTags(tagsRes.tags);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!showTagPicker) return;
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowTagPicker(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showTagPicker]);

  async function handleTagsChange(newTags: string[]) {
    if (!summary || !id) return;
    const rollback = summary.tags;
    setSummary((prev) => (prev ? { ...prev, tags: newTags } : prev));
    try {
      const res = await api.updateSummaryTags(id, newTags);
      setSummary((prev) => (prev ? { ...prev, tags: res.tags } : prev));
      const tagsRes = await api.getAllTags().catch(() => null);
      if (tagsRes) setAllTags(tagsRes.tags);
    } catch {
      setSummary((prev) => (prev ? { ...prev, tags: rollback } : prev));
    }
  }

  async function handleRetry() {
    if (!id) return;
    setRetrying(true);
    try {
      await api.retryQueueItem(id);
      setSummary((prev) => (prev ? { ...prev, status: "pending", summaryJson: undefined } : prev));
      const interval = setInterval(async () => {
        try {
          const res = await api.getSummary(id);
          setSummary(res.summary);
          if (res.summary.status === "completed" || res.summary.status === "failed") {
            clearInterval(interval);
            setRetrying(false);
          }
        } catch {
          clearInterval(interval);
          setRetrying(false);
        }
      }, 3000);
    } catch {
      setRetrying(false);
    }
  }

  async function handleAutoTag() {
    if (!id) return;
    setAutoTagLoading(true);
    try {
      const result = await api.autoTagSummary(id);
      setAutoTagResult(result);
    } catch (err) {
      console.error("Auto-tag failed:", err);
    } finally {
      setAutoTagLoading(false);
    }
  }

  function handleAutoTagApplyOne(tag: string) {
    if (!summary) return;
    handleTagsChange([...summary.tags, tag]);
    setAutoTagResult((prev) => {
      if (!prev) return null;
      const remaining = {
        existing: prev.existing.filter((t) => t !== tag),
        new: prev.new.filter((t) => t !== tag),
      };
      return remaining.existing.length === 0 && remaining.new.length === 0 ? null : remaining;
    });
  }

  function handleAutoTagApplyAll(tags: string[]) {
    if (!summary) return;
    handleTagsChange([...summary.tags, ...tags]);
    setAutoTagResult(null);
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6">
        <Nav />
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-3 border-neon-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="max-w-3xl mx-auto px-6">
        <Nav />
        <div className="text-center py-16">
          <p className="text-sm text-red-600 dark:text-red-400">{error || "Summary not found"}</p>
          <Link
            to="/dashboard"
            className="inline-block mt-4 text-sm font-semibold text-neon-600 hover:underline"
          >
            &larr; Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const json = summary.summaryJson;
  const ctx =
    json?.contextSection ??
    (json?.actionItems?.length
      ? { title: "Action Items", icon: "→", items: json.actionItems, groups: undefined }
      : null);
  const isPro = false; // TODO: thread usage/plan through if needed for auto-tag gating

  return (
    <div className="max-w-3xl mx-auto px-6 pb-12">
      <Nav />

      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1 text-sm font-semibold text-(--color-text-muted) hover:text-neon-600 no-underline transition-colors mb-6"
      >
        &larr; Dashboard
      </Link>

      {/* Video metadata */}
      <div className="flex items-start gap-4 mb-6">
        <a
          href={`https://youtube.com/watch?v=${summary.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
        >
          <img
            src={`https://i.ytimg.com/vi/${summary.videoId}/hqdefault.jpg`}
            alt=""
            className="w-48 h-auto rounded-xl border-2 border-(--color-border-hard) shadow-brutal-sm object-cover hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
          />
        </a>
        <div className="min-w-0">
          <a
            href={`https://youtube.com/watch?v=${summary.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline text-(--color-text)"
          >
            <h1 className="text-xl font-bold leading-snug m-0 hover:text-neon-600 transition-colors">
              {summary.videoTitle || summary.videoId}
            </h1>
          </a>
          <div className="flex items-center gap-2 text-sm text-(--color-text-muted) mt-1.5">
            {summary.videoChannel && <span>{summary.videoChannel}</span>}
            {summary.videoDurationSeconds != null && summary.videoDurationSeconds > 0 && (
              <>
                <span>&middot;</span>
                <span>{formatTimeSaved(summary.videoDurationSeconds)}</span>
              </>
            )}
          </div>

          {/* Tags + editing */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {summary.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border-2 border-(--color-border-soft)"
              >
                {tag}
                <button
                  onClick={() => handleTagsChange(summary.tags.filter((t) => t !== tag))}
                  className="bg-transparent border-0 p-0 cursor-pointer text-neon-500 hover:text-red-500 transition-colors leading-none"
                  title={`Remove "${tag}"`}
                >
                  &times;
                </button>
              </span>
            ))}
            <div className="relative" ref={pickerRef}>
              <button
                onClick={() => setShowTagPicker((v) => !v)}
                className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border-2 border-(--color-border-soft) hover:border-neon-300 hover:text-neon-600 cursor-pointer transition-colors"
              >
                + tag
              </button>
              {showTagPicker && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm py-1 min-w-[140px]">
                  {allTags.filter((t) => !summary.tags.includes(t)).length > 0 ? (
                    allTags
                      .filter((t) => !summary.tags.includes(t))
                      .map((t) => (
                        <button
                          key={t}
                          onClick={() => {
                            handleTagsChange([...summary.tags, t]);
                            setShowTagPicker(false);
                          }}
                          className="w-full text-left text-xs font-bold px-3 py-1.5 bg-transparent border-0 cursor-pointer text-(--color-text-secondary) hover:bg-neon-100 hover:text-neon-600 dark:hover:bg-neon-900/30 dark:hover:text-neon-300 transition-colors"
                        >
                          {t}
                        </button>
                      ))
                  ) : (
                    <span className="block text-xs text-(--color-text-faint) px-3 py-1.5">
                      No more tags
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Auto-tag button — Pro only */}
            {isPro && !autoTagResult && json && (
              <button
                onClick={handleAutoTag}
                disabled={autoTagLoading}
                className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-neon-100 dark:bg-neon-900/30 text-neon-700 dark:text-neon-400 border-2 border-neon-300 dark:border-neon-700 hover:bg-neon-200 dark:hover:bg-neon-900/50 cursor-pointer transition-colors disabled:opacity-50"
              >
                {autoTagLoading ? "..." : "✨ Auto-tag"}
              </button>
            )}
          </div>

          {/* TagSuggestions for this page */}
          {autoTagResult && (
            <div className="mt-2">
              <TagSuggestions
                existing={autoTagResult.existing}
                new={autoTagResult.new}
                currentTags={summary.tags}
                onApplyOne={handleAutoTagApplyOne}
                onApply={handleAutoTagApplyAll}
                onDismiss={() => setAutoTagResult(null)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Summary content */}
      {!json ? (
        summary.status === "pending" || summary.status === "processing" ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-8 h-8 border-3 border-neon-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-(--color-text-muted)">
              {summary.status === "pending" ? "Queued..." : "Generating summary..."}
            </p>
          </div>
        ) : summary.status === "failed" ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-sm text-red-600 dark:text-red-400">Summary generation failed.</p>
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="text-sm font-bold px-4 py-2 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer disabled:opacity-50 transition-all"
            >
              {retrying ? "Retrying..." : "Retry"}
            </button>
          </div>
        ) : (
          <p className="text-(--color-text-muted)">No summary data available.</p>
        )
      ) : (
        <div className="space-y-5">
          {json.truncated && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              This summary is based on a partial transcript. The video was too long to process in
              full.
            </div>
          )}

          <section className="bg-(--color-surface-raised) rounded-xl p-5">
            <h2 className="text-xs font-bold uppercase tracking-wide text-neon-600 mb-2">TL;DR</h2>
            <p className="text-base text-(--color-text-body) leading-relaxed m-0 italic">
              {json.summary}
            </p>
          </section>

          {json.keyPoints.length > 0 && (
            <section className="bg-(--color-surface-raised) rounded-xl p-5">
              <h2 className="text-xs font-bold uppercase tracking-wide text-neon-600 mb-2">
                Highlights
              </h2>
              <ul className="list-none p-0 m-0 space-y-2">
                {json.keyPoints.map((point, i) => (
                  <li key={i} className="flex gap-2 text-sm text-(--color-text-body)">
                    <span className="text-neon-500 font-bold shrink-0">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {json.timestamps.length > 0 && (
            <section className="bg-(--color-surface-raised) rounded-xl p-5">
              <h2 className="text-xs font-bold uppercase tracking-wide text-neon-600 mb-2">
                Jump To
              </h2>
              <ul className="list-none p-0 m-0 space-y-1.5">
                {json.timestamps.map((ts, i) => {
                  const parsed = extractTimestamp(ts);
                  if (parsed) {
                    return (
                      <li key={i} className="flex items-baseline gap-3 text-sm">
                        <a
                          href={`https://youtube.com/watch?v=${summary.videoId}&t=${parsed.seconds}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-16 text-right text-neon-600 hover:text-neon-800 font-mono text-xs font-bold shrink-0 no-underline transition-colors"
                        >
                          {parsed.time}
                        </a>
                        <span className="text-(--color-text-body)">{parsed.label}</span>
                      </li>
                    );
                  }
                  return (
                    <li key={i} className="text-sm text-(--color-text-body)">
                      {ts}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {ctx && (
            <section className="bg-(--color-surface-raised) rounded-xl p-5">
              <h2 className="text-xs font-bold uppercase tracking-wide text-neon-600 mb-2">
                {ctx.title}
              </h2>
              {ctx.groups?.length ? (
                <div className="space-y-4">
                  {ctx.groups.map((group, gi) => (
                    <div key={gi}>
                      <h3 className="text-xs font-semibold text-(--color-text-secondary) uppercase tracking-wide mb-1">
                        {group.label}
                      </h3>
                      <ul className="list-none p-0 m-0 space-y-1.5">
                        {group.items.map((item, i) => (
                          <li key={i} className="flex gap-2 text-sm text-(--color-text-body)">
                            <span className="text-neon-500 font-bold shrink-0">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="list-none p-0 m-0 space-y-1.5">
                  {ctx.items.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm text-(--color-text-body)">
                      <span className="text-neon-500 font-bold shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -C apps/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run dev server and verify SummaryPage**

```bash
pnpm dev:prodApi
```

Navigate to a summary — verify:

- Tags shown with × to remove
- `+ tag` button opens dropdown
- "Retry" button appears for failed summaries
- ✨ Auto-tag button visible for Pro users (set `isPro = true` locally to test)

- [ ] **Step 4: Revert `isPro = true` test hack if applied, commit**

```bash
git add apps/web/src/pages/SummaryPage.tsx
git commit -m "add tag editing, retry, and auto-tag to web summary page"
```

---

## Chunk 5: Final Verification

### Task 8: Wire up usage-based isPro in SummaryPage

**Files:**

- Modify: `apps/web/src/pages/SummaryPage.tsx`

The SummaryPage currently hardcodes `isPro = false`. Fix it to read from the API.

- [ ] **Step 1: Fetch usage in SummaryPage and derive isPro**

In `SummaryPage`, add usage state and fetch it alongside summary + tags:

```tsx
const [isPro, setIsPro] = useState(false);
```

In the `useEffect`, extend the Promise.all:

```tsx
Promise.all([
  api.getSummary(id),
  api.getAllTags().catch(() => ({ tags: [] })),
  api.getUsage().catch(() => null),
])
  .then(([res, tagsRes, usageRes]) => {
    setSummary(res.summary);
    setAllTags(tagsRes.tags);
    if (usageRes) setIsPro(usageRes.usage.plan === "pro");
  })
  .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
  .finally(() => setLoading(false));
```

Remove the `const isPro = false;` line from the render section.

- [ ] **Step 2: Typecheck**

```bash
pnpm -C apps/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/SummaryPage.tsx
git commit -m "derive isPro from usage in SummaryPage for auto-tag gating"
```

---

### Task 9: Full build verification

- [ ] **Step 1: Run lint**

```bash
pnpm lint
```

Fix any issues before proceeding.

- [ ] **Step 2: Run unit tests**

```bash
pnpm test:unit
```

Expected: all tests pass.

- [ ] **Step 3: Build web app**

```bash
pnpm build:web
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 4: Build extension**

```bash
pnpm build:extension
```

Expected: clean build.

- [ ] **Step 5: Manual smoke test — Dashboard**

With `pnpm dev:prodApi` running:

1. Open http://localhost:5173/dashboard
2. Title shows "Your Cliphub"
3. Search filters summaries by title/channel
4. Sort toggles newest/oldest
5. Tag filter chips appear and filter the list
6. Clicking title when filter active clears it
7. Hover a card → checkbox appears top-right, delete button bottom-right
8. Click checkbox → selection ring appears, action bar slides in (Pro users)
9. Bulk auto-tag flow (Pro): select cards → ✨ Auto-tag → suggestions appear per card
10. Apply all / Dismiss all banner works
11. Inline tag add/remove works with optimistic update
12. Free plan banner shows at bottom for free users

- [ ] **Step 6: Manual smoke test — SummaryPage**

1. Click a summary card → navigates to `/summary/:id`
2. Tags editable (add via dropdown, remove via ×)
3. Failed summary shows Retry button → clicking retries and polls
4. Pro users see ✨ Auto-tag button → clicking shows TagSuggestions inline
