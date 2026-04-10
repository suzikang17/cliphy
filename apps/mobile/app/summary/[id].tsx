import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, SafeAreaView, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Summary } from "@cliphy/shared";
import { neon } from "@cliphy/shared";
import { getSummary } from "../../lib/api";
import { SummaryContent } from "../../components/SummaryContent";
import { QueueCardSkeleton } from "../../components/Skeleton";
import { brutalShadowSm } from "../../lib/theme";

export default function SummaryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSummary(id)
      .then((res) => setSummary(res.summary))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-[#1e1e1e]">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-[#e5e7eb] dark:border-[#2a2a2a]">
        <Pressable onPress={() => router.back()}>
          <Text className="text-sm font-bold" style={{ fontFamily: "DMSans", color: neon[600] }}>
            ← Back
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="px-4 py-4 gap-3">
          <QueueCardSkeleton />
          <QueueCardSkeleton />
        </View>
      ) : summary ? (
        <ScrollView contentContainerClassName="px-4 py-4">
          {/* Video info header */}
          <View
            className="border-2 border-black dark:border-[#505050] rounded-lg p-3 mb-5 bg-[#f9fafb] dark:bg-[#282828]"
            style={brutalShadowSm()}
          >
            <Text
              className="text-base font-bold text-[#111827] dark:text-white"
              style={{ fontFamily: "DMSans" }}
            >
              {summary.videoTitle}
            </Text>
            {summary.videoChannel && (
              <Text className="text-xs text-[#6b7280] mt-0.5" style={{ fontFamily: "DMSans" }}>
                {summary.videoChannel}
              </Text>
            )}
            {summary.videoUrl && (
              <Pressable onPress={() => Linking.openURL(summary.videoUrl!)} className="mt-2">
                <Text
                  className="text-xs font-bold"
                  style={{ fontFamily: "DMSans", color: neon[600] }}
                >
                  Watch on YouTube →
                </Text>
              </Pressable>
            )}
          </View>

          <SummaryContent summary={summary} />
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center">
          <Text className="text-[#6b7280]" style={{ fontFamily: "DMSans" }}>
            Summary not found
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
