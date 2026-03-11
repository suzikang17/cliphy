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
    <div className="sticky bottom-4 mx-auto max-w-2xl bg-(--color-surface-raised) border border-(--color-border-soft) rounded-xl px-4 py-3 shadow-brutal-sm flex items-center justify-between z-10">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-(--color-text)">{selectedCount} selected</span>
        {selectedCount < totalCount && (
          <button
            onClick={onSelectAll}
            className="text-neon-500 hover:text-neon-400 bg-transparent border-0 p-0 cursor-pointer text-sm"
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
          className="bg-neon-600 hover:bg-neon-700 text-white px-4 py-1.5 rounded-lg text-sm border-0 cursor-pointer transition-colors disabled:opacity-50"
        >
          {loading ? "Tagging..." : "✨ Auto-tag"}
        </button>
        <button
          onClick={onDelete}
          className="bg-red-900/50 hover:bg-red-900/70 text-red-300 px-4 py-1.5 rounded-lg text-sm border border-red-800/50 cursor-pointer transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
