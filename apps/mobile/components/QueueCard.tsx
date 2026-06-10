import { View, Text, Pressable, Image, useColorScheme, Animated } from "react-native";
import { useEffect, useRef } from "react";
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
  const cardBg = isDark ? "#282828" : "#f9fafb";

  // Gentle pulse while summarizing so the corner dot reads as "in progress"
  // rather than just another colored dot.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (item.status !== "processing") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [item.status, pulse]);

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
      <View className="flex-row gap-3">
        <View>
          <Image
            source={{ uri: `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg` }}
            resizeMode="cover"
            className="w-28 h-16 rounded-md border-2 border-black dark:border-[#505050] bg-[#e5e7eb] dark:bg-[#1e1e1e]"
            accessibilityIgnoresInvertColors
          />
          {/* Status dot, top-right corner of the thumbnail. The ring (border in
              card-bg color) lifts it off the image so it reads on any frame. */}
          <Animated.View
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: statusColor,
              borderWidth: 2,
              borderColor: cardBg,
              opacity: item.status === "processing" ? pulse : 1,
            }}
          />
        </View>

        <View className="flex-1 min-w-0">
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
              numberOfLines={1}
            >
              {item.videoChannel}
            </Text>
          )}

          {item.tags && item.tags.length > 0 && (
            <View className="flex-row gap-1 mt-2">
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
      </View>
    </Pressable>
  );
}
