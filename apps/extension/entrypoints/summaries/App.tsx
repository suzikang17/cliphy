import type { Summary, UsageInfo } from "@cliphy/shared";
import {
  formatTimeSaved,
  FREE_HISTORY_DAYS,
  MAX_FREE_UNIQUE_TAGS,
  relativeDate,
  TAG_MAX_LENGTH,
} from "@cliphy/shared";
import { useEffect, useMemo, useState } from "react";
import { SummaryDetail } from "../../components/SummaryDetail";
import { SummaryCardSkeleton } from "../../components/Skeleton";
import {
  deleteSummary,
  getAllTags,
  getSummaries,
  getUsage,
  TagLimitError,
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

  async function handleFilterTag(tag: string | null) {
    setFilterTag(tag);
    try {
      const res = await getSummaries(tag ?? undefined);
      setSummaries(res.summaries);
    } catch {
      // silently fail — list stays as-is
    }
  }

  async function handleTagsChange(summaryId: string, newTags: string[]) {
    try {
      const res = await updateSummaryTags(summaryId, newTags);
      setSummaries((prev) => prev.map((s) => (s.id === summaryId ? { ...s, tags: res.tags } : s)));
      if (selectedSummary?.id === summaryId) {
        setSelectedSummary((prev) => (prev ? { ...prev, tags: res.tags } : prev));
      }
      const tagsRes = await getAllTags();
      setAllTags(tagsRes.tags);
    } catch (err) {
      if (err instanceof TagLimitError) {
        const tagsRes = await getAllTags();
        setAllTags(tagsRes.tags);
      }
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

  function handleSelectSummary(summary: Summary) {
    setSelectedSummary(summary);
    setView("detail");
    window.location.hash = `#/summary/${summary.id}`;
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

  // Client-side search + sort
  const displayedSummaries = useMemo(() => {
    let result = summaries;

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
  }, [summaries, searchQuery, sortOrder]);

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
        />
      </div>
    );
  }

  // List view
  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <Header usage={usage} />
      <Toolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        allTags={allTags}
        filterTag={filterTag}
        onFilterTag={handleFilterTag}
        sortOrder={sortOrder}
        onSortChange={setSortOrder}
      />
      <CardList
        summaries={displayedSummaries}
        totalCount={summaries.length}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
        filterTag={filterTag}
        onSelect={handleSelectSummary}
        onDelete={handleDelete}
        allTags={allTags}
        onTagsChange={handleTagsChange}
      />
    </div>
  );
}

function Header({ usage }: { usage: UsageInfo | null }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold m-0">
          <span className="text-neon-500">&#9654;</span> Cliphy
        </h1>
        {usage && (
          <div className="text-right">
            <span className="text-xs font-bold text-(--color-text-secondary)">
              {usage.used}/{usage.limit} this month
            </span>
            {usage.totalTimeSavedSeconds > 0 && (
              <p className="text-[10px] text-(--color-text-faint) m-0">
                {formatTimeSaved(usage.totalTimeSavedSeconds)} saved
              </p>
            )}
          </div>
        )}
      </div>
      {usage?.plan === "free" && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-(--color-text-muted) bg-(--color-warn-surface) border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-1.5">
          <span>
            Showing last {FREE_HISTORY_DAYS} days.{" "}
            <button
              onClick={() => openCheckout()}
              className="text-amber-600 hover:text-amber-800 font-bold bg-transparent border-0 p-0 cursor-pointer transition-colors"
            >
              Upgrade to Pro
            </button>{" "}
            for unlimited history.
          </span>
        </div>
      )}
    </div>
  );
}

function Toolbar({
  searchQuery,
  onSearchChange,
  allTags,
  filterTag,
  onFilterTag,
  sortOrder,
  onSortChange,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  allTags: string[];
  filterTag: string | null;
  onFilterTag: (tag: string | null) => void;
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
          className="w-full text-xs font-bold pl-8 pr-3 py-1.5 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) text-(--color-text) placeholder:text-(--color-text-faint) outline-none focus:border-neon-500 transition-colors"
        />
      </div>
      {allTags.length > 0 && (
        <select
          value={filterTag ?? ""}
          onChange={(e) => onFilterTag(e.target.value || null)}
          className="text-xs font-bold px-2 py-1.5 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) text-(--color-text) cursor-pointer"
        >
          <option value="">All tags</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      )}
      <select
        value={sortOrder}
        onChange={(e) => onSortChange(e.target.value as SortOrder)}
        className="text-xs font-bold px-2 py-1.5 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) text-(--color-text) cursor-pointer"
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
  onSelect,
  onDelete,
  allTags,
  onTagsChange,
}: {
  summaries: Summary[];
  totalCount: number;
  hasFilters: boolean;
  onClearFilters: () => void;
  filterTag: string | null;
  onSelect: (s: Summary) => void;
  onDelete: (id: string) => void;
  allTags: string[];
  onTagsChange: (id: string, tags: string[]) => Promise<void>;
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
}: {
  summary: Summary;
  onSelect: (s: Summary) => void;
  onDelete: (id: string) => void;
  allTags: string[];
  onTagsChange: (id: string, tags: string[]) => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete(s.id);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  }

  function handleTagAdd() {
    const tag = tagInput.toLowerCase().trim();
    if (!tag || tag.length > TAG_MAX_LENGTH || s.tags.includes(tag)) {
      setTagInput("");
      setAddingTag(false);
      return;
    }
    onTagsChange(s.id, [...s.tags, tag]).catch(() => {});
    setTagInput("");
    setAddingTag(false);
  }

  function handleTagKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTagAdd();
    } else if (e.key === "Escape") {
      setTagInput("");
      setAddingTag(false);
    }
  }

  return (
    <div
      onClick={() => onSelect(s)}
      className="group relative w-full text-left bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg p-3 shadow-brutal-sm cursor-pointer hover:shadow-brutal-pressed press-down transition-all"
    >
      <div className="flex items-start gap-3">
        <img
          src={`https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`}
          alt=""
          className="w-28 h-16 rounded border-2 border-(--color-border-hard) object-cover shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-(--color-text) m-0 line-clamp-1">
              {s.videoTitle || s.videoId}
            </p>
            <span className="text-[10px] text-(--color-text-faint) whitespace-nowrap shrink-0">
              {relativeDate(s.createdAt)}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-(--color-text-faint) mt-0.5 m-0">
            {s.videoChannel && <span>{s.videoChannel}</span>}
            {s.videoChannel && s.videoDurationSeconds != null && s.videoDurationSeconds > 0 && (
              <span>&middot;</span>
            )}
            {s.videoDurationSeconds != null && s.videoDurationSeconds > 0 && (
              <span>{formatTimeSaved(s.videoDurationSeconds)}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {s.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-neon-100 text-neon-700 border border-neon-300 dark:bg-neon-900/30 dark:text-neon-400 dark:border-neon-700 font-bold"
              >
                {tag}
              </span>
            ))}
            {addingTag ? (
              <div className="inline-flex items-center" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  list={`tags-${s.id}`}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={handleTagAdd}
                  maxLength={TAG_MAX_LENGTH}
                  placeholder="tag name"
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-neon-300 bg-(--color-surface) text-(--color-text) outline-none w-24"
                  autoFocus
                />
                <datalist id={`tags-${s.id}`}>
                  {allTags
                    .filter((t) => !s.tags.includes(t))
                    .map((t) => (
                      <option key={t} value={t} />
                    ))}
                </datalist>
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setAddingTag(true);
                }}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border border-(--color-border-soft) hover:border-neon-300 hover:text-neon-600 cursor-pointer transition-colors opacity-0 group-hover:opacity-100"
                title="Add tag"
              >
                + tag
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Delete button — visible on hover */}
      <button
        onClick={handleDeleteClick}
        className={`absolute right-2 bottom-2 text-[10px] font-bold px-1.5 py-0.5 rounded border bg-transparent cursor-pointer transition-all ${
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
