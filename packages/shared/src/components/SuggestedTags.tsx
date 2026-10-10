import { tagPath } from "../tags";

interface SuggestedTagsProps {
  /** Persisted suggestions (clip.suggestedTags). Renders nothing when empty. */
  tags: string[];
  /** Tap the chip → becomes a real tag. */
  onAccept: (tag: string) => void;
  /** Tap ✕ → removed from suggestions. */
  onDismiss: (tag: string) => void;
  className?: string;
}

/**
 * Controlled row of AI-suggested new tags (from the auto-tag pipeline step).
 * Unlike TagSuggestions (a one-shot auto-tag result), these live on the clip until
 * accepted or dismissed, so the parent owns the list and updates it optimistically.
 */
export function SuggestedTags({ tags, onAccept, onDismiss, className = "" }: SuggestedTagsProps) {
  if (tags.length === 0) return null;

  return (
    <div className={`flex items-center gap-1 flex-wrap ${className}`}>
      <span className="text-[10px] text-purple-700 dark:text-purple-400 font-bold mr-1 shrink-0">
        ✨ Suggested:
      </span>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center rounded-full text-[10px] font-bold border border-dashed border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAccept(tag);
            }}
            title={`Add tag "${tag}"`}
            className="pl-2 pr-1 py-0.5 bg-transparent border-0 cursor-pointer text-inherit font-bold hover:underline"
          >
            + {tagPath(tag).join(" › ")}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(tag);
            }}
            aria-label={`Dismiss suggested tag "${tag}"`}
            className="pr-2 pl-0.5 py-0.5 bg-transparent border-0 cursor-pointer text-inherit opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}
