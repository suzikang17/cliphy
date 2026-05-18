import type { UsageInfo } from "@cliphy/shared";
import { formatTimeSaved } from "@cliphy/shared";

interface UsageBarProps {
  usage: UsageInfo;
  onOpenCliphy?: () => void;
}

export function UsageBar({ usage, onOpenCliphy }: UsageBarProps) {
  const isFree = usage.plan === "free";
  const atLimit = isFree && usage.used >= usage.limit;
  const pct = usage.limit > 0 ? Math.min((usage.used / usage.limit) * 100, 100) : 0;

  return (
    <div className="relative h-7 bg-(--color-surface-raised) rounded-md border-2 border-(--color-border-hard) shadow-brutal-sm overflow-hidden text-xs font-bold">
      <div
        className={`absolute inset-y-0 left-0 ${atLimit ? "bg-red-200/60 dark:bg-red-500/25" : "bg-neon-200/50 dark:bg-neon-500/25"}`}
        style={{ width: `${pct}%` }}
      />
      {/* Dividers at 1/3 and 2/3 with tiny cliphy logos */}
      {[{ left: "33.333%" }, { left: "66.666%" }].map(({ left }) => (
        <div
          key={left}
          className="absolute inset-y-0 flex items-center justify-center pointer-events-none"
          style={{ left, transform: "translateX(-50%)" }}
        >
          <div className="w-px h-full bg-(--color-border-hard) opacity-40" />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            width="12"
            height="12"
            className="absolute shrink-0"
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
        </div>
      ))}
      <div className="absolute inset-0 grid grid-cols-3 items-center text-xs font-bold text-(--color-text)">
        <div className="flex justify-center">
          <span className={atLimit ? "text-red-600 dark:text-red-400" : ""}>
            {atLimit ? "Limit reached" : `${usage.used} / ${usage.limit} used`}
          </span>
        </div>
        <div className="flex justify-center">
          {isFree ? (
            <button
              onClick={onOpenCliphy}
              className="bg-transparent border-0 p-0 font-bold text-xs text-neon-600 dark:text-neon-400 cursor-pointer hover:text-neon-800 dark:hover:text-neon-200 transition-colors"
            >
              cliphy.app ↗
            </button>
          ) : (
            <span className="px-1.5 py-0.5 rounded bg-neon-600 text-white text-[10px] leading-none tracking-wide uppercase">
              Pro
            </span>
          )}
        </div>
        <div className="flex justify-center items-center gap-1">
          {usage.totalTimeSavedSeconds > 0 ? (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>{formatTimeSaved(usage.totalTimeSavedSeconds)} saved</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
