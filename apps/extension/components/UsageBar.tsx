import type { UsageInfo } from "@cliphy/shared";
import { formatTimeSaved } from "@cliphy/shared";
import { Logo } from "./Logo";

interface UsageBarProps {
  usage: UsageInfo;
  onOpenApp?: () => void;
}

export function UsageBar({ usage, onOpenApp }: UsageBarProps) {
  const isFree = usage.plan === "free";
  const credits = usage.bonusCredits ?? 0;
  // One-off credits cover usage after the monthly allowance, so the user is only
  // truly "at limit" when both the monthly cap and the wallet are exhausted.
  const atLimit = isFree && usage.used >= usage.limit && credits <= 0;
  const pct = usage.limit > 0 ? Math.min((usage.used / usage.limit) * 100, 100) : 0;
  const hasTimeSaved = usage.totalTimeSavedSeconds > 0;

  return (
    <div className="relative h-9 bg-(--color-surface-raised) rounded-md border-2 border-(--color-border-hard) shadow-brutal-sm overflow-hidden text-sm font-bold">
      <div
        className={`absolute inset-y-0 left-0 ${atLimit ? "bg-red-200/60 dark:bg-red-500/25" : "bg-neon-200/50 dark:bg-neon-500/25"}`}
        style={{ width: `${pct}%` }}
      />
      <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm font-bold text-(--color-text)">
        <span className={atLimit ? "text-red-600 dark:text-red-400" : ""}>
          {atLimit ? "Limit reached" : `${usage.used} / ${usage.limit} used`}
        </span>
        {credits > 0 && (
          <span className="text-neon-600 dark:text-neon-400" title="One-off bonus credits">
            +{credits} credit{credits === 1 ? "" : "s"}
          </span>
        )}
        {hasTimeSaved && (
          <>
            {onOpenApp ? (
              <button
                onClick={onOpenApp}
                className="bg-transparent border-0 p-0 cursor-pointer shrink-0 opacity-80 hover:opacity-100 transition-opacity"
                title="Open Cliphy App"
              >
                <Logo size={18} />
              </button>
            ) : (
              <Logo size={18} />
            )}
            <span>{formatTimeSaved(usage.totalTimeSavedSeconds)} saved</span>
          </>
        )}
      </div>
    </div>
  );
}
