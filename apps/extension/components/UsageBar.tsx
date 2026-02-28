import type { UsageInfo } from "@cliphy/shared";
import { UPGRADE_URL } from "@cliphy/shared";

interface UsageBarProps {
  usage: UsageInfo;
}

export function UsageBar({ usage }: UsageBarProps) {
  const remaining = Math.max(usage.limit - usage.used, 0);
  const atLimit = remaining === 0;
  const isFree = usage.plan === "free";

  return (
    <div className="flex items-center gap-2 text-xs font-bold">
      <span className={atLimit ? "text-red-500" : "text-gray-600"}>
        {atLimit ? "No summaries left today" : `${remaining} summaries left today`}
      </span>
      {isFree && atLimit && (
        <a
          href={UPGRADE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-bold text-amber-600 hover:text-amber-800 no-underline transition-colors"
        >
          Need more? Upgrade
        </a>
      )}
      {isFree && !atLimit && (
        <span className="text-[10px] text-gray-400">
          Free plan &middot;{" "}
          <a
            href={UPGRADE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-600 hover:text-amber-800 no-underline transition-colors"
          >
            Get 100/day with Pro
          </a>
        </span>
      )}
    </div>
  );
}
