import type { UsageInfo } from "@cliphy/shared";
import { formatTimeSaved } from "@cliphy/shared";

interface UsageBarProps {
  usage: UsageInfo;
  onUpgrade?: () => void;
  upgradeLoading?: boolean;
}

export function UsageBar({ usage, onUpgrade, upgradeLoading }: UsageBarProps) {
  const isFree = usage.plan === "free";
  const pct = usage.limit > 0 ? Math.min((usage.used / usage.limit) * 100, 100) : 0;

  return (
    <div className="relative h-10 bg-(--color-surface-raised) rounded-lg border-2 border-(--color-border-hard) shadow-brutal-sm overflow-hidden text-sm font-bold">
      <div
        className="absolute inset-y-0 left-0 bg-neon-200/50 dark:bg-neon-500/25"
        style={{ width: `${pct}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-center gap-2">
        <span>
          {usage.used} / {usage.limit} used
        </span>
        <span>&middot;</span>
        {isFree ? (
          <button
            onClick={onUpgrade}
            disabled={upgradeLoading}
            className="bg-transparent border-0 p-0 font-bold text-sm text-neon-600 dark:text-neon-400 cursor-pointer hover:text-neon-800 dark:hover:text-neon-200 transition-colors disabled:opacity-50"
          >
            {upgradeLoading ? "Opening..." : "Upgrade"}
          </button>
        ) : (
          <span className="px-2 py-0.5 rounded bg-neon-600 text-white text-xs leading-none tracking-wide uppercase">
            Pro
          </span>
        )}
        {usage.totalTimeSavedSeconds > 0 && (
          <>
            <span>&middot;</span>
            <span>{formatTimeSaved(usage.totalTimeSavedSeconds)} saved</span>
          </>
        )}
      </span>
    </div>
  );
}
