import type { UsageInfo } from "@cliphy/shared";
import { formatTimeSaved } from "@cliphy/shared";

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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 512 512"
              width="14"
              height="14"
              className="shrink-0"
            >
              <path
                d="M190,68 L322,68 Q330,68 330,76 L336,160 L360,160 Q372,160 372,172 L372,370 Q372,448 256,448 Q140,448 140,370 L140,172 Q140,160 152,160 L176,160 L182,76 Q182,68 190,68 Z"
                fill="#d898b8"
                stroke="#111827"
                strokeWidth="8"
              />
              <rect x="224" y="82" width="64" height="64" rx="14" fill="#c0769e" />
              <polygon points="248,98 248,130 272,114" fill="#ffffff" />
              <circle cx="212" cy="272" r="14" fill="#111827" />
              <circle cx="300" cy="272" r="14" fill="#111827" />
              <path
                d="M208,334 Q256,378 304,334"
                fill="none"
                stroke="#111827"
                strokeWidth="8"
                strokeLinecap="round"
              />
            </svg>
            <span>{formatTimeSaved(usage.totalTimeSavedSeconds)} saved</span>
          </>
        )}
      </div>
    </div>
  );
}
