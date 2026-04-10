import { View, Text, Pressable, useColorScheme } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { Summary } from "@cliphy/shared";
import { neon } from "@cliphy/shared";
import { brutalShadowSm } from "../lib/theme";

const STATUS_LABELS: Record<string, { label: string; color: string; darkColor: string }> = {
  pending: { label: "Queued", color: "#6b7280", darkColor: "#9ca3af" },
  processing: { label: "Summarizing...", color: neon[600], darkColor: neon[600] },
  completed: { label: "Done", color: "#16a34a", darkColor: "#4ade80" },
  failed: { label: "Failed", color: "#dc2626", darkColor: "#f87171" },
};

const STATUS_HINT: Record<string, string> = {
  pending: "Waiting in queue\u2026",
  processing: "Still summarizing — check back soon",
  failed: "Summarization failed",
};

export function QueueCard({ item }: { item: Summary }) {
  const router = useRouter();
  const isDark = useColorScheme() === "dark";
  const status = STATUS_LABELS[item.status] ?? STATUS_LABELS.pending;
  const statusColor = isDark ? status.darkColor : status.color;

  function handlePress() {
    if (item.status === "completed") {
      router.push(`/summary/${item.id}`);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      className="border-2 border-black dark:border-[#505050] rounded-lg p-3 bg-[#f9fafb] dark:bg-[#282828]"
      style={brutalShadowSm()}
      accessibilityRole="button"
      accessibilityLabel={`${item.videoTitle || item.videoId}, ${status.label}`}
      accessibilityHint={item.status === "completed" ? "Opens summary" : STATUS_HINT[item.status]}
    >
      <Text
        className="text-base font-bold text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
        numberOfLines={2}
      >
        {item.videoTitle || `Video ${item.videoId}`}
      </Text>

      {item.videoChannel && (
        <Text
          className="text-xs text-[#6b7280] dark:text-[#9ca3af] mt-0.5"
          style={{ fontFamily: "DMSans" }}
        >
          {item.videoChannel}
        </Text>
      )}

      <View className="flex-row items-center justify-between mt-2">
        <View className="flex-row items-center gap-1.5">
          <View className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor }} />
          <Text
            className="text-xs font-medium"
            style={{ fontFamily: "DMSans", color: statusColor }}
          >
            {status.label}
          </Text>
        </View>

        {item.tags && item.tags.length > 0 && (
          <View className="flex-row gap-1">
            {item.tags.slice(0, 2).map((tag) => (
              <View key={tag} className="bg-[#ede0f8] dark:bg-[#221028] px-2 py-0.5 rounded">
                <Text className="text-[10px]" style={{ fontFamily: "DMSans", color: neon[600] }}>
                  {tag}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}
