import { View, Text } from "react-native";
import type { UsageInfo } from "@cliphy/shared";
import { neon } from "@cliphy/shared";

export function UsageBar({ usage }: { usage: UsageInfo | null }) {
  if (!usage) return null;
  const pct = Math.min((usage.used / usage.limit) * 100, 100);

  return (
    <View className="px-4 py-3 border-t border-[#e5e7eb] dark:border-[#2a2a2a] bg-white dark:bg-[#1e1e1e]">
      <View className="flex-row justify-between mb-1.5">
        <Text className="text-xs text-[#6b7280]" style={{ fontFamily: "DMSans" }}>
          {usage.used}/{usage.limit} summaries
        </Text>
        <Text className="text-xs font-bold" style={{ fontFamily: "DMSans", color: neon[600] }}>
          {usage.plan}
        </Text>
      </View>
      <View className="h-2 rounded-full bg-[#e5e7eb] dark:bg-[#383838]">
        <View
          className="h-2 rounded-full"
          style={{ width: `${pct}%`, backgroundColor: neon[600] }}
        />
      </View>
    </View>
  );
}
