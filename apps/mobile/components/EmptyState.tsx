import { View, Text } from "react-native";

export function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center py-20 px-6">
      <Text className="text-4xl mb-3">🎬</Text>
      <Text
        className="text-lg font-bold text-[#111827] dark:text-white text-center"
        style={{ fontFamily: "DMSans" }}
      >
        No videos yet
      </Text>
      <Text className="text-sm text-[#6b7280] text-center mt-1" style={{ fontFamily: "DMSans" }}>
        Share a YouTube video to get started
      </Text>
    </View>
  );
}
