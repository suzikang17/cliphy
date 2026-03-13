import { useState } from "react";

interface TagSuggestion {
  tag: string;
  isNew: boolean;
  checked: boolean;
}

interface TagSuggestionsProps {
  existing: string[];
  new: string[];
  currentTags: string[];
  onApply: (tags: string[]) => void;
  onDismiss: () => void;
}

export function TagSuggestions({
  existing,
  new: newTags,
  currentTags,
  onApply,
  onDismiss,
}: TagSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>(() => [
    ...existing
      .filter((t) => !currentTags.includes(t))
      .map((tag) => ({ tag, isNew: false, checked: true })),
    ...newTags.map((tag) => ({ tag, isNew: true, checked: true })),
  ]);

  if (suggestions.length === 0) {
    return (
      <div className="mt-2 p-3 rounded-lg bg-(--color-surface-raised) border border-(--color-border-soft) text-sm text-(--color-text-muted)">
        No tag suggestions — this video's content is already well-covered by existing tags.
        <button
          onClick={onDismiss}
          className="ml-2 text-(--color-text-muted) hover:text-(--color-text) bg-transparent border-0 p-0 cursor-pointer underline text-sm"
        >
          Dismiss
        </button>
      </div>
    );
  }

  function toggleTag(index: number) {
    setSuggestions((prev) => prev.map((s, i) => (i === index ? { ...s, checked: !s.checked } : s)));
  }

  function handleApply() {
    const selected = suggestions.filter((s) => s.checked).map((s) => s.tag);
    onApply([...currentTags, ...selected]);
  }

  const anyChecked = suggestions.some((s) => s.checked);

  return (
    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] text-(--color-text-faint)">✨</span>
      {suggestions.map((s, i) => (
        <button
          key={s.tag}
          onClick={() => toggleTag(i)}
          className={`
            px-2 py-0.5 rounded-full text-[10px] font-bold border-2 cursor-pointer transition-all
            ${
              s.checked
                ? s.isNew
                  ? "bg-neon-100 border-neon-400 text-neon-700 dark:bg-neon-900/30 dark:border-neon-600 dark:text-neon-300"
                  : "bg-emerald-100 border-emerald-400 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-600 dark:text-emerald-300"
                : "bg-(--color-surface) border-(--color-border-soft) text-(--color-text-muted) opacity-50 line-through"
            }
          `}
        >
          {s.isNew && <span className="text-[9px] opacity-70 mr-0.5">NEW</span>}
          {s.tag}
        </button>
      ))}
      <button
        onClick={handleApply}
        disabled={!anyChecked}
        className="text-[10px] font-bold text-neon-600 hover:text-neon-800 bg-transparent border-0 p-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Apply
      </button>
      <button
        onClick={onDismiss}
        className="text-[10px] text-(--color-text-faint) hover:text-(--color-text-muted) bg-transparent border-0 p-0 cursor-pointer"
      >
        ✕
      </button>
    </div>
  );
}
