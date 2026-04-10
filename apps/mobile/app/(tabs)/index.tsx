import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, RefreshControl, SafeAreaView, AppState, Alert } from "react-native";
import type { Summary, UsageInfo } from "@cliphy/shared";
import { neon } from "@cliphy/shared";
import { getQueue, getUsage, addToQueue } from "../../lib/api";
import { getYouTubeUrlFromClipboard } from "../../lib/clipboard";
import { QueueCard } from "../../components/QueueCard";
import { QueueCardSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { UsageBar } from "../../components/UsageBar";
import { Logo } from "../../components/Logo";

export default function QueueScreen() {
  const [items, setItems] = useState<Summary[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [queueRes, usageRes] = await Promise.all([getQueue(), getUsage()]);
      setItems(queueRes.items);
      setUsage(usageRes.usage);
    } catch (err) {
      console.error("Failed to fetch queue:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  // Clipboard YouTube URL detection on app focus
  const lastClipboardUrl = useRef<string | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;

      const url = await getYouTubeUrlFromClipboard();
      if (!url || url === lastClipboardUrl.current) return;

      lastClipboardUrl.current = url;

      Alert.alert("YouTube link detected", "Add this video to your queue?", [
        { text: "No", style: "cancel" },
        {
          text: "Add",
          onPress: async () => {
            try {
              const res = await addToQueue({ videoUrl: url });
              Alert.alert("Added!", res.summary.videoTitle || "Video queued");
              fetchData();
            } catch (err: unknown) {
              Alert.alert("Error", err instanceof Error ? err.message : "Failed to add");
            }
          },
        },
      ]);
    });

    return () => subscription.remove();
  }, [fetchData]);

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-[#1e1e1e]">
      <View className="flex-row items-center px-4 py-3 border-b border-[#e5e7eb] dark:border-[#2a2a2a]">
        <Logo size={28} />
        <Text
          className="text-lg font-bold ml-2 text-[#111827] dark:text-white"
          style={{ fontFamily: "DMSans" }}
        >
          Cliphy
        </Text>
      </View>

      {loading ? (
        <View className="px-4 py-4 gap-3">
          <QueueCardSkeleton />
          <QueueCardSkeleton />
          <QueueCardSkeleton />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <QueueCard item={item} />}
          contentContainerClassName="px-4 py-4 gap-3"
          ListEmptyComponent={<EmptyState />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={neon[600]} />
          }
        />
      )}

      <UsageBar usage={usage} />
    </SafeAreaView>
  );
}
