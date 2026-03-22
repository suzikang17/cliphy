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
    <div className="mt-2 border-t border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2 flex items-center gap-1.5 flex-wrap">
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
