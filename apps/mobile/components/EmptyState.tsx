import { View, Text } from "react-native";
import { neon } from "@cliphy/shared";

export function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center py-20 px-6">
      <Text className="text-4xl mb-4">🎬</Text>
      <Text
        className="text-lg font-bold text-[#111827] dark:text-white text-center"
        style={{ fontFamily: "DMSans" }}
      >
        No videos yet
      </Text>
      <Text
        className="text-base text-[#6b7280] dark:text-[#9ca3af] text-center mt-2 leading-6"
        style={{ fontFamily: "DMSans" }}
      >
        <Text className="font-bold" style={{ color: neon[600] }}>
          Copy
        </Text>{" "}
        a YouTube link and open Cliphy — we'll offer to queue it
      </Text>
      <Text
        className="text-sm text-[#9ca3af] dark:text-[#6b7280] text-center mt-3"
        style={{ fontFamily: "DMSans" }}
      >
        Or share from YouTube: Share → Cliphy
      </Text>
    </View>
  );
}
