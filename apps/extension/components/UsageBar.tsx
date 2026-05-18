import type { UsageInfo } from "@cliphy/shared";
import { formatTimeSaved } from "@cliphy/shared";
import { Logo } from "./Logo";

interface UsageBarProps {
  usage: UsageInfo;
}

export function UsageBar({ usage }: UsageBarProps) {
  const isFree = usage.plan === "free";
  const atLimit = isFree && usage.used >= usage.limit;
  const pct = usage.limit > 0 ? Math.min((usage.used / usage.limit) * 100, 100) : 0;
  const hasTimeSaved = usage.totalTimeSavedSeconds > 0;

  return (
    <div className="relative h-9 bg-(--color-surface-raised) rounded-md border-2 border-(--color-border-hard) shadow-brutal-sm overflow-hidden text-xs font-bold">
      <div
        className={`absolute inset-y-0 left-0 ${atLimit ? "bg-red-200/60 dark:bg-red-500/25" : "bg-neon-200/50 dark:bg-neon-500/25"}`}
        style={{ width: `${pct}%` }}
      />
      <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs font-bold text-(--color-text)">
        <span className={atLimit ? "text-red-600 dark:text-red-400" : ""}>
          {atLimit ? "Limit reached" : `${usage.used} / ${usage.limit} used`}
        </span>
        {hasTimeSaved && (
          <>
            <Logo size={14} />
            <span>{formatTimeSaved(usage.totalTimeSavedSeconds)} saved</span>
          </>
        )}
      </div>
    </div>
  );
}
