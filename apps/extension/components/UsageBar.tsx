import { useState } from "react";
import type { UsageInfo } from "@cliphy/shared";
import { formatTimeSaved } from "@cliphy/shared";
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

  const pct = usage.limit > 0 ? Math.min((usage.used / usage.limit) * 100, 100) : 0;

  return (
    <div className="flex flex-col gap-1.5 text-xs font-bold">
      <div className="relative h-7 bg-(--color-surface-raised) rounded-md border-2 border-(--color-border-hard) shadow-brutal-sm overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${atLimit ? "bg-red-300" : "bg-neon-200"}`}
          style={{ width: `${pct}%` }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-(--color-text) gap-1.5">
          <span>
            {usage.used} / {usage.limit} used
          </span>
          {usage.totalTimeSavedSeconds > 0 && (
            <>
              <span>&middot;</span>
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
          )}
          <span>&middot;</span>
          {isFree ? (
            <button
              onClick={handleUpgrade}
              className="bg-transparent border-0 p-0 font-bold text-xs text-neon-600 cursor-pointer hover:text-neon-800 transition-colors"
            >
              Upgrade
            </button>
          ) : (
            <span className="text-neon-600">Pro user</span>
          )}
        </span>
      </div>
      {isFree && (
        <button
          onClick={handleUpgrade}
          disabled={loading}
          className="inline-flex items-center justify-center gap-1.5 w-full text-sm font-bold px-4 py-2.5 bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all disabled:opacity-50"
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
