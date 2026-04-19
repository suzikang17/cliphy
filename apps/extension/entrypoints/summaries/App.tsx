import type { AutoTagSuggestion, Summary, UsageInfo } from "@cliphy/shared";
import {
  formatTimeSaved,
  FREE_HISTORY_DAYS,
  MAX_FREE_UNIQUE_TAGS,
  relativeDate,
} from "@cliphy/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "../../components/Logo";
import { SelectionActionBar, TagSuggestions } from "@cliphy/shared";
import { SummaryCardSkeleton } from "../../components/Skeleton";
import { SummaryDetail } from "../../components/SummaryDetail";
import {
  autoTagBulk,
  deleteSummary,
  getAllTags,
  getSummaries,
  getSummary,
  getUsage,
  retryQueueItem,
  updateSummaryTags,
} from "../../lib/api";
import { openCheckout } from "../../lib/checkout";
import { isAuthenticated } from "../../lib/auth";

type View = "list" | "detail";
type SortOrder = "newest" | "oldest";

function parseSummaryIdFromHash(): string | null {
  const hash = window.location.hash;
  const match = hash.match(/^#\/summary\/(.+)$/);
  return match ? match[1] : null;
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("list");
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<Summary | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoTagResults, setAutoTagResults] = useState<Map<string, AutoTagSuggestion>>(new Map());
  const [bulkAutoTagLoading, setBulkAutoTagLoading] = useState(false);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    try {
      const authenticated = await isAuthenticated();
      setAuthed(authenticated);
      if (!authenticated) {
        setLoading(false);
        return;
      }

      const [summariesRes, usageRes] = await Promise.all([getSummaries(), getUsage()]);
      setSummaries(summariesRes.summaries);
      setUsage(usageRes.usage);

      // Tags fetch is non-fatal — page works without autocomplete
      try {
        const tagsRes = await getAllTags();
        setAllTags(tagsRes.tags);
      } catch {
        // Tags endpoint may not be deployed yet
      }

      const deepLinkId = parseSummaryIdFromHash();
      if (deepLinkId) {
        const match = summariesRes.summaries.find((s) => s.id === deepLinkId);
        if (match) {
          setSelectedSummary(match);
          setView("detail");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load summaries");
    } finally {
      setLoading(false);
    }
  }

  function handleFilterTag(tag: string | null) {
    setFilterTag(tag);
  }

  async function handleTagsChange(summaryId: string, newTags: string[]) {
    // Optimistic update — reflect immediately in UI
    const rollback = summaries.find((s) => s.id === summaryId)?.tags;
    setSummaries((prev) => {
      const updated = prev.map((s) => (s.id === summaryId ? { ...s, tags: newTags } : s));
      // Recompute allTags so removed tags disappear immediately
      const all = new Set<string>();
      for (const s of updated) for (const t of s.tags) all.add(t);
      setAllTags([...all].sort());
      // Clear filter if the filtered tag no longer exists
      if (filterTag && !all.has(filterTag)) setFilterTag(null);
      return updated;
    });
    if (selectedSummary?.id === summaryId) {
      setSelectedSummary((prev) => (prev ? { ...prev, tags: newTags } : prev));
    }

    try {
      const [res] = await Promise.all([
        updateSummaryTags(summaryId, newTags),
        getAllTags().then((r) => setAllTags(r.tags)),
      ]);
      // Reconcile with server response
      setSummaries((prev) => prev.map((s) => (s.id === summaryId ? { ...s, tags: res.tags } : s)));
      if (selectedSummary?.id === summaryId) {
        setSelectedSummary((prev) => (prev ? { ...prev, tags: res.tags } : prev));
      }
    } catch (err) {
      // Rollback on failure
      if (rollback !== undefined) {
        setSummaries((prev) =>
          prev.map((s) => (s.id === summaryId ? { ...s, tags: rollback } : s)),
        );
        if (selectedSummary?.id === summaryId) {
          setSelectedSummary((prev) => (prev ? { ...prev, tags: rollback } : prev));
        }
      }
      const tagsRes = await getAllTags().catch(() => null);
      if (tagsRes) setAllTags(tagsRes.tags);
      throw err;
    }
  }

  async function handleDelete(id: string) {
    // Optimistic removal
    const prev = summaries;
    setSummaries((s) => s.filter((x) => x.id !== id));
    try {
      await deleteSummary(id);
    } catch {
      // Restore on failure
      setSummaries(prev);
    }
  }

  async function handleRetry(id: string) {
    const original = summaries.find((s) => s.id === id);
    // Optimistic: show as pending, clear old summary
    const pending = { status: "pending" as const, summaryJson: undefined, errorMessage: undefined };
    setSummaries((prev) => prev.map((s) => (s.id === id ? { ...s, ...pending } : s)));
    if (selectedSummary?.id === id) {
      setSelectedSummary((prev) => (prev ? { ...prev, ...pending } : prev));
    }
    try {
      await retryQueueItem(id);
      // Poll until complete (no realtime subscription on this page)
      pollSummary(id);
    } catch {
      if (original) {
        setSummaries((prev) => prev.map((s) => (s.id === id ? original : s)));
        if (selectedSummary?.id === id) setSelectedSummary(original);
      }
    }
  }

  function pollSummary(id: string) {
    const interval = setInterval(async () => {
      try {
        const res = await getSummary(id);
        const s = res.summary;
        // Update status while processing
        setSummaries((prev) => prev.map((x) => (x.id === id ? s : x)));
        setSelectedSummary((prev) => (prev?.id === id ? s : prev));
        if (s.status === "completed" || s.status === "failed") {
          clearInterval(interval);
        }
      } catch {
        clearInterval(interval);
      }
    }, 3000);
  }

  const hasSelection = selectedIds.size > 0;
  const isPro = usage?.plan === "pro";

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
      const response = await autoTagBulk(ids);
      const newResults = new Map(autoTagResults);
      for (const suggestion of response.suggestions) {
        if (!suggestion.skipped && suggestion.existing && suggestion.new) {
          newResults.set(suggestion.summaryId, {
            existing: suggestion.existing,
            new: suggestion.new,
          });
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
    // Apply sequentially to avoid race conditions on shared allTags state
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
    const ids = [...selectedIds];
    for (const id of ids) {
      await handleDelete(id);
    }
    clearSelection();
  }

  function handleSelectSummary(summary: Summary) {
    setSelectedSummary(summary);
    setView("detail");
    window.location.hash = `#/summary/${summary.id}`;
    window.scrollTo(0, 0);
  }

  function handleBack() {
    setSelectedSummary(null);
    setView("list");
    window.location.hash = "";
  }

  const hasFilters = searchQuery !== "" || filterTag !== null;

  function clearFilters() {
    setSearchQuery("");
    if (filterTag) {
      handleFilterTag(null);
    }
  }

  // Client-side search + tag filter + sort
  const displayedSummaries = useMemo(() => {
    let result = summaries;

    if (filterTag) {
      result = result.filter((s) => s.tags.includes(filterTag));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          (s.videoTitle ?? "").toLowerCase().includes(q) ||
          (s.videoChannel ?? "").toLowerCase().includes(q),
      );
    }

    if (sortOrder === "oldest") {
      result = [...result].reverse();
    }

    return result;
  }, [summaries, searchQuery, sortOrder, filterTag]);

  // Loading
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Header usage={null} />
        <div className="space-y-2">
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
          <SummaryCardSkeleton />
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!authed) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Header usage={null} />
        <div className="text-center py-16">
          <p className="text-sm font-bold">Sign in via the extension popup to view summaries.</p>
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Header usage={null} />
        <div className="bg-(--color-error-surface) border-2 border-(--color-border-hard) rounded-lg p-4 mt-4">
          <p className="text-sm text-red-700 font-bold m-0">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              init();
            }}
            className="mt-3 text-xs font-bold px-4 py-2 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Detail view
  if (view === "detail" && selectedSummary) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Header usage={usage} />
        <button
          onClick={handleBack}
          className="text-xs font-bold text-neon-600 hover:text-neon-800 bg-transparent border-0 cursor-pointer p-0 mb-4 transition-colors"
        >
          &larr; All summaries
        </button>
        <SummaryDetail
          summary={selectedSummary}
          allTags={allTags}
          tagLimitReached={usage?.plan === "free" && allTags.length >= MAX_FREE_UNIQUE_TAGS}
          onTagsChange={(tags) => handleTagsChange(selectedSummary.id, tags)}
          onRetry={() => handleRetry(selectedSummary.id)}
        />
      </div>
    );
  }

  // List view
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <Header
        usage={usage}
        allTags={allTags}
        filterTag={filterTag}
        onFilterTag={handleFilterTag}
        onClearAll={clearFilters}
      />
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
        onFilterTag={handleFilterTag}
        onSelect={handleSelectSummary}
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
        <div className="sticky bottom-16 mx-auto max-w-2xl bg-white dark:bg-(--color-surface-raised) border-2 border-(--color-border-hard) rounded-xl px-4 py-3 shadow-brutal-sm flex items-center justify-between z-10 mb-2">
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
              onClick={() => openCheckout()}
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

function Header({
  allTags,
  filterTag,
  onFilterTag,
  onClearAll,
}: {
  usage?: UsageInfo | null;
  allTags?: string[];
  filterTag?: string | null;
  onFilterTag?: (tag: string | null) => void;
  onClearAll?: () => void;
}) {
  const hasActiveFilter = !!filterTag;
  return (
    <div className="mb-4">
      <h1
        onClick={hasActiveFilter ? onClearAll : undefined}
        className={`text-2xl font-extrabold m-0 text-center ${hasActiveFilter ? "cursor-pointer hover:text-neon-600 transition-colors" : ""}`}
        title={hasActiveFilter ? "Clear all filters" : undefined}
      >
        <span className="inline-flex items-center justify-center gap-1.5">
          <Logo size={28} /> Cliphub
        </span>
      </h1>
      {allTags && allTags.length > 0 && onFilterTag && (
        <div className="mt-2 flex justify-center">
          <TagChips tags={allTags} filterTag={filterTag ?? null} onFilterTag={onFilterTag} inline />
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

function TagChips({
  tags,
  filterTag,
  onFilterTag,
  inline,
}: {
  tags: string[];
  filterTag: string | null;
  onFilterTag: (tag: string | null) => void;
  inline?: boolean;
}) {
  const chipClass = (tag: string) =>
    `text-[10px] font-bold px-2 py-0.5 rounded-full border-2 cursor-pointer transition-all ${
      filterTag === tag
        ? "bg-(--color-surface) text-neon-600 border-neon-400 dark:text-neon-300 dark:border-neon-600 shadow-none translate-x-[2px] translate-y-[2px]"
        : "bg-(--color-surface) text-(--color-text-secondary) border-(--color-border-hard) shadow-brutal-sm hover:shadow-brutal-pressed press-down hover:border-neon-300 hover:text-neon-600"
    }`;

  return (
    <div className={`flex flex-wrap gap-1.5 ${inline ? "" : "mb-4"}`}>
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => onFilterTag(filterTag === tag ? null : tag)}
          className={chipClass(tag)}
        >
          {tag}
        </button>
      ))}
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
  onSelect,
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
  onSelect: (s: Summary) => void;
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
  // No summaries at all
  if (totalCount === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm font-bold">No summaries yet</p>
        <p className="text-xs text-(--color-text-faint) mt-1">
          Visit a YouTube video and queue it from the Cliphy popup.
        </p>
      </div>
    );
  }

  // Filters active but no matches
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
          onSelect={onSelect}
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
  onSelect,
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
  onSelect: (s: Summary) => void;
  onDelete: (id: string) => void;
  allTags: string[];
  onTagsChange: (id: string, tags: string[]) => Promise<void>;
  filterTag: string | null;
  onFilterTag: (tag: string | null) => void;
  hasSelection?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  isPro?: boolean;
  autoTagResult?: AutoTagSuggestion;
  onAutoTagApplyOne?: (tag: string) => void;
  onAutoTagApplyAll?: (tags: string[]) => void;
  onAutoTagDismiss?: () => void;
}) {
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
      onClick={() => onSelect(s)}
      className={`group relative w-full text-left bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg p-3 shadow-brutal-sm cursor-pointer hover:shadow-brutal-pressed press-down transition-all ${showTagPicker ? "z-10" : ""} ${isSelected ? "ring-2 ring-neon-500/50" : ""} ${hasSelection && !isSelected ? "opacity-70" : ""}`}
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
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect?.();
                }}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${
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
      {autoTagResult && onAutoTagApplyOne && onAutoTagApplyAll && onAutoTagDismiss && (
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
      {/* Delete button — visible on hover */}
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
