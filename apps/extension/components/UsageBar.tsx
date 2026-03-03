import { useState } from "react";
import type { UsageInfo } from "@cliphy/shared";
import { openCheckout } from "../lib/checkout";

interface UsageBarProps {
  usage: UsageInfo;
  onUpgraded?: () => void;
}

export function UsageBar({ usage, onUpgraded }: UsageBarProps) {
  const remaining = Math.max(usage.limit - usage.used, 0);
  const atLimit = remaining === 0;
  const isFree = usage.plan === "free";
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    setLoading(true);
    await openCheckout(onUpgraded);
    setLoading(false);
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs font-bold">
      <span className={atLimit ? "text-red-500" : "text-(--color-text-secondary)"}>
        {atLimit ? "No summaries left this month" : `${remaining} summaries left this month`}
      </span>
      {isFree && (
        <button
          onClick={handleUpgrade}
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 w-full text-sm font-bold px-4 py-2.5 bg-purple-600 text-white border-2 border-purple-800 rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
            <path d="M8 1l2.35 4.76 5.26.77-3.8 3.7.9 5.24L8 13.07l-4.71 2.4.9-5.24-3.8-3.7 5.26-.77z" />
          </svg>
          {loading
            ? "Opening checkout..."
            : atLimit
              ? "Upgrade \u2014 get 100/mo"
              : "Get 100/mo with Pro"}
        </button>
      )}
    </div>
  );
}
