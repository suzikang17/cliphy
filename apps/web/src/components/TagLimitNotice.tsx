interface TagLimitNoticeProps {
  message: string;
  onUpgrade: () => void;
  upgradeLoading?: boolean;
  onDismiss: () => void;
}

/** Shown when a tag save is rejected with 403 TAG_LIMIT (free plan unique-tag cap). */
export function TagLimitNotice({
  message,
  onUpgrade,
  upgradeLoading,
  onDismiss,
}: TagLimitNoticeProps) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 text-[11px] text-(--color-text-muted) bg-(--color-warn-surface) border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-1.5"
    >
      <span>
        {message}{" "}
        <button
          onClick={onUpgrade}
          disabled={upgradeLoading}
          className="text-amber-600 hover:text-amber-800 font-bold bg-transparent border-0 p-0 cursor-pointer transition-colors disabled:opacity-50"
        >
          {upgradeLoading ? "Opening..." : "Upgrade to Pro"}
        </button>
      </span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 bg-transparent border-0 p-0 cursor-pointer text-(--color-text-faint) hover:text-(--color-text) leading-none"
      >
        &times;
      </button>
    </div>
  );
}
