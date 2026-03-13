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
    <div className="mt-2 p-3 rounded-lg bg-(--color-surface-raised) border border-(--color-border-soft)">
      <div className="text-xs text-(--color-text-muted) mb-2">✨ Suggested tags</div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {suggestions.map((s, i) => (
          <button
            key={s.tag}
            onClick={() => toggleTag(i)}
            className={`
              px-2.5 py-1 rounded-full text-xs font-bold border-2 cursor-pointer transition-all
              ${
                s.checked
                  ? s.isNew
                    ? "bg-neon-100 border-neon-400 text-neon-700 dark:bg-neon-900/30 dark:border-neon-600 dark:text-neon-300"
                    : "bg-emerald-100 border-emerald-400 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-600 dark:text-emerald-300"
                  : "bg-(--color-surface) border-(--color-border-soft) text-(--color-text-muted) opacity-50"
              }
            `}
          >
            {s.isNew && <span className="text-[10px] font-extrabold opacity-70 mr-1">NEW</span>}
            {s.tag}
            {s.checked ? " ✓" : ""}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onDismiss}
          className="text-sm text-(--color-text-muted) hover:text-(--color-text) bg-transparent border-0 px-2 py-1 cursor-pointer"
        >
          Dismiss
        </button>
        <button
          onClick={handleApply}
          disabled={!anyChecked}
          className="text-sm bg-neon-600 text-white px-4 py-1 rounded-lg border-0 cursor-pointer hover:bg-neon-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Apply selected
        </button>
      </div>
    </div>
  );
}
