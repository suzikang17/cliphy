import { useState } from "react";
import { openCheckout } from "../lib/checkout";

interface UpgradePromptProps {
  /** Contextual message, e.g. "Queue all 12 tabs at once" */
  message: string;
  onDismiss?: () => void;
}

/**
 * Friendly, non-pushy upgrade prompt shown when a free user
 * tries to access a Pro feature.
 */
export function UpgradePrompt({ message, onDismiss }: UpgradePromptProps) {
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    setLoading(true);
    await openCheckout();
    setLoading(false);
  }

  return (
    <div className="bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200 rounded-lg p-3">
      <p className="text-sm text-gray-800 font-medium m-0 leading-snug">{message}</p>
      <div className="flex items-center gap-2 mt-2.5">
        <button
          onClick={handleUpgrade}
          disabled={loading}
          className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 bg-amber-500 text-white border-2 border-amber-700 rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer no-underline transition-all disabled:opacity-50"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
            <path d="M8 1l2.35 4.76 5.26.77-3.8 3.7.9 5.24L8 13.07l-4.71 2.4.9-5.24-3.8-3.7 5.26-.77z" />
          </svg>
          {loading ? "Opening checkout..." : "Upgrade to Pro"}
        </button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-xs text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer p-0 transition-colors"
          >
            Maybe later
          </button>
        )}
      </div>
    </div>
  );
}
