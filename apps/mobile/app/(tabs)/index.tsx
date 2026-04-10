import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  SafeAreaView,
  AppState,
  Alert,
  Pressable,
  Animated,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { Summary, UsageInfo } from "@cliphy/shared";
import { neon } from "@cliphy/shared";
import { getQueue, getUsage, addToQueue } from "../../lib/api";
import { getYouTubeUrlFromClipboard } from "../../lib/clipboard";
import { supabase } from "../../lib/supabase";
import { QueueCard } from "../../components/QueueCard";
import { QueueCardSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { UsageBar } from "../../components/UsageBar";
import { Logo } from "../../components/Logo";
import { brutalShadowSm } from "../../lib/theme";

export default function QueueScreen() {
  const [items, setItems] = useState<Summary[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [clipboardBanner, setClipboardBanner] = useState<string | null>(null);
  const bannerOpacity = useRef(new Animated.Value(0)).current;

  const fetchData = useCallback(async () => {
    try {
      setError(false);
      const [queueRes, usageRes] = await Promise.all([getQueue(), getUsage()]);
      setItems(queueRes.items);
      setUsage(usageRes.usage);
    } catch (err) {
      console.error("Failed to fetch queue:", err);
      setError(true);
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

  // Supabase Realtime — live queue updates
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id;
      if (!userId) return;

      channel = supabase
        .channel(`queue-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "summaries",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const updated = payload.new as Summary;

            if (payload.eventType === "INSERT") {
              setItems((prev) => [updated, ...prev]);
            } else if (payload.eventType === "UPDATE") {
              setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
            } else if (payload.eventType === "DELETE") {
              const deleted = payload.old as { id: string };
              setItems((prev) => prev.filter((item) => item.id !== deleted.id));
            }
          },
        )
        .subscribe();
    });

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Clipboard YouTube URL detection on app focus — non-blocking banner
  const lastClipboardUrl = useRef<string | null>(null);

  function showBanner(url: string) {
    setClipboardBanner(url);
    Animated.timing(bannerOpacity, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }

  function dismissBanner() {
    Animated.timing(bannerOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setClipboardBanner(null));
  }

  async function handleAddFromClipboard() {
    if (!clipboardBanner) return;
    const url = clipboardBanner;
    dismissBanner();
    try {
      await addToQueue({ videoUrl: url });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchData();
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to add");
    }
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;

      const url = await getYouTubeUrlFromClipboard();
      if (!url || url === lastClipboardUrl.current) return;

      lastClipboardUrl.current = url;
      showBanner(url);

      // Auto-dismiss after 8 seconds
      setTimeout(() => {
        dismissBanner();
      }, 8000);
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
      ) : error ? (
        <View className="flex-1 items-center justify-center py-20 px-6">
          <Text className="text-4xl mb-4">😵</Text>
          <Text
            className="text-lg font-bold text-[#111827] dark:text-white text-center"
            style={{ fontFamily: "DMSans" }}
          >
            Couldn't load your queue
          </Text>
          <Text
            className="text-base text-[#6b7280] text-center mt-2"
            style={{ fontFamily: "DMSans" }}
          >
            Check your connection and try again
          </Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              fetchData();
            }}
            className="mt-5 px-6 py-3 border-2 border-black dark:border-[#505050] rounded-lg"
            style={{ backgroundColor: neon[600], ...brutalShadowSm() }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading queue"
          >
            <Text className="text-white font-bold text-base" style={{ fontFamily: "DMSans" }}>
              Retry
            </Text>
          </Pressable>
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

      {/* Clipboard detection banner */}
      {clipboardBanner && (
        <Animated.View
          style={{ opacity: bannerOpacity }}
          className="absolute bottom-24 left-4 right-4"
        >
          <View
            className="flex-row items-center justify-between p-3 border-2 border-black dark:border-[#505050] rounded-lg bg-[#f9fafb] dark:bg-[#282828]"
            style={brutalShadowSm()}
          >
            <View className="flex-1 mr-3">
              <Text
                className="text-sm font-bold text-[#111827] dark:text-white"
                style={{ fontFamily: "DMSans" }}
              >
                YouTube link detected
              </Text>
              <Text
                className="text-xs text-[#6b7280] mt-0.5"
                style={{ fontFamily: "DMSans" }}
                numberOfLines={1}
              >
                {clipboardBanner}
              </Text>
            </View>
            <View className="flex-row gap-2">
              <Pressable
                onPress={dismissBanner}
                style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
              >
                <Text className="text-sm text-[#6b7280]" style={{ fontFamily: "DMSans" }}>
                  Skip
                </Text>
              </Pressable>
              <Pressable
                onPress={handleAddFromClipboard}
                className="px-3 py-2 rounded-md"
                style={{ backgroundColor: neon[600], minHeight: 36, justifyContent: "center" }}
                accessibilityRole="button"
                accessibilityLabel="Add video to queue"
              >
                <Text className="text-white font-bold text-sm" style={{ fontFamily: "DMSans" }}>
                  Add
                </Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}

      <UsageBar usage={usage} />
    </SafeAreaView>
  );
}
