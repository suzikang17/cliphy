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
