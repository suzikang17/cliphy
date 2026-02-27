import type { UsageInfo } from "@cliphy/shared";

interface UsageBarProps {
  usage: UsageInfo;
}

export function UsageBar({ usage }: UsageBarProps) {
  const atLimit = usage.used >= usage.limit;
  const percent = Math.min((usage.used / usage.limit) * 100, 100);

  return (
    <div>
      <div className="text-xs font-bold text-gray-600 mb-1">
        <span>
          {usage.used}/{usage.limit} summaries today
        </span>
      </div>
      <div className="h-2 bg-gray-200 border-2 border-black rounded overflow-hidden">
        <div
          className={`h-full transition-all ${atLimit ? "bg-red-400" : "bg-indigo-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
