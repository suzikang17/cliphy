import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, RefreshControl, SafeAreaView } from "react-native";
import type { Summary, UsageInfo } from "@cliphy/shared";
import { neon } from "@cliphy/shared";
import { getQueue, getUsage } from "../../lib/api";
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

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-[#1e1e1e]">
      {/* Header */}
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
