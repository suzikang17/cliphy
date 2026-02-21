import type { UsageInfo } from "@cliphy/shared";

interface UsageBarProps {
  usage: UsageInfo;
}

export function UsageBar({ usage }: UsageBarProps) {
  const atLimit = usage.used >= usage.limit;
  const percent = Math.min((usage.used / usage.limit) * 100, 100);

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
        <span>
          {usage.used}/{usage.limit} summaries today
        </span>
        <span className="capitalize">{usage.plan} plan</span>
      </div>
      <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${atLimit ? "bg-red-500" : "bg-blue-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
