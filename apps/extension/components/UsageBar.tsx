import type { UsageInfo } from "@cliphy/shared";
import { formatTimeSaved } from "@cliphy/shared";

interface UsageBarProps {
  usage: UsageInfo;
}

export function UsageBar({ usage }: UsageBarProps) {
  const atLimit = usage.used >= usage.limit;
  const percent = Math.min((usage.used / usage.limit) * 100, 100);

  return (
    <div>
      <div className="flex items-center justify-between text-xs font-bold text-gray-600 mb-1">
        <span>
          {usage.used}/{usage.limit} summaries today
        </span>
        <span className="bg-indigo-100 border-2 border-black text-indigo-700 px-2 py-0.5 text-[10px] font-bold rounded capitalize">
          {usage.plan} plan
        </span>
      </div>
      <div className="h-2 bg-gray-200 border-2 border-black rounded overflow-hidden">
        <div
          className={`h-full transition-all ${atLimit ? "bg-red-400" : "bg-indigo-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {usage.totalTimeSavedSeconds > 0 && (
        <p className="text-[10px] text-gray-400 mt-1 text-right">
          {formatTimeSaved(usage.totalTimeSavedSeconds)} of video saved
        </p>
      )}
    </div>
  );
}
