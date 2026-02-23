import type { UsageInfo } from "@cliphy/shared";

interface UsageBarProps {
  usage: UsageInfo;
}

export function UsageBar({ usage }: UsageBarProps) {
  const atLimit = usage.used >= usage.limit;
  const percent = Math.min((usage.used / usage.limit) * 100, 100);

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">
        <span>
          {usage.used}/{usage.limit} summaries today
        </span>
        <span className="capitalize border border-current px-1.5 py-0.5">{usage.plan} plan</span>
      </div>
      <div className="h-1.5 bg-gray-200 overflow-hidden">
        <div
          className={`h-full transition-all ${atLimit ? "bg-red-500" : "bg-blue-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
