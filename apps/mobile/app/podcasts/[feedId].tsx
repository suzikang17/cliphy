import {
  View,
  Text,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { PodcastFeed, PodcastEpisode, PodcastEpisodeStatus } from "@cliphy/shared";
import { neon } from "@cliphy/shared";
import {
  getPodcastFeeds,
  getPodcastEpisodes,
  queuePodcastEpisode,
  skipPodcastEpisode,
} from "../../lib/api";
import { EpisodeCard } from "../../components/EpisodeCard";

type Filter = "all" | "pending" | "done";

const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  pending: "Pending",
  done: "Done",
};

const FILTER_STATUSES: Record<Filter, PodcastEpisodeStatus[] | null> = {
  all: null,
  pending: ["pending_approval", "queued", "processing"],
  done: ["done", "skipped"],
};

export default function FeedEpisodesScreen() {
  const { feedId } = useLocalSearchParams<{ feedId: string }>();
  const router = useRouter();

  const [feed, setFeed] = useState<PodcastFeed | null>(null);
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    load();
  }, [feedId]);

  async function load() {
    try {
      const [allFeeds, eps] = await Promise.all([getPodcastFeeds(), getPodcastEpisodes(feedId)]);
      setFeed(allFeeds.find((f) => f.id === feedId) ?? null);
      setEpisodes(eps);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to load episodes");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleQueue(episode: PodcastEpisode) {
    try {
      const updated = await queuePodcastEpisode(episode.id);
      setEpisodes((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to queue episode");
    }
  }

  async function handleSkip(episode: PodcastEpisode) {
    try {
      const updated = await skipPodcastEpisode(episode.id);
      setEpisodes((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to skip episode");
    }
  }

  const filteredEpisodes = episodes.filter((e) => {
    const statuses = FILTER_STATUSES[filter];
    if (!statuses) return true;
    return statuses.includes(e.status);
  });

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-[#1e1e1e]">
      {/* Header */}
      <View className="flex-row items-center px-2 py-1 border-b border-[#e5e7eb] dark:border-[#2a2a2a]">
        <Pressable
          onPress={() => router.back()}
          style={{
            minHeight: 44,
            minWidth: 44,
            justifyContent: "center",
            alignItems: "center",
            flexDirection: "row",
            paddingHorizontal: 8,
          }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={neon[600]} />
          <Text className="text-base" style={{ fontFamily: "DMSans", color: neon[600] }}>
            Back
          </Text>
        </Pressable>
        <Text
          className="flex-1 text-base font-bold text-[#111827] dark:text-white text-center"
          style={{ fontFamily: "DMSans" }}
          numberOfLines={1}
        >
          {feed?.title ?? "Episodes"}
        </Text>
        {/* spacer to balance the back button */}
        <View style={{ minWidth: 44 + 8 * 2 }} />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={neon[600]} />
        </View>
      ) : (
        <FlatList
          data={filteredEpisodes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={neon[600]}
            />
          }
          ListHeaderComponent={
            /* Filter bar */
            <View className="flex-row mb-4 gap-2">
              {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => {
                const active = filter === f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFilter(f)}
                    className={`px-3 py-1.5 border-2 rounded ${
                      active
                        ? "bg-black dark:bg-white border-black dark:border-white"
                        : "bg-white dark:bg-[#282828] border-[#d1d5db] dark:border-[#505050]"
                    }`}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter: ${FILTER_LABELS[f]}`}
                  >
                    <Text
                      className={`text-xs font-bold ${
                        active ? "text-white dark:text-black" : "text-[#6b7280] dark:text-[#9ca3af]"
                      }`}
                      style={{ fontFamily: "DMSans" }}
                    >
                      {FILTER_LABELS[f]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          }
          ListEmptyComponent={
            <View className="items-center py-16 border-2 border-dashed border-[#d1d5db] dark:border-[#404040] rounded-lg">
              <Text
                className="text-sm font-bold text-[#111827] dark:text-white mb-1"
                style={{ fontFamily: "DMSans" }}
              >
                No episodes
              </Text>
              <Text
                className="text-sm text-[#6b7280] dark:text-[#9ca3af] text-center px-4"
                style={{ fontFamily: "DMSans" }}
              >
                {filter === "all"
                  ? "No episodes found for this feed."
                  : `No episodes with "${FILTER_LABELS[filter]}" status.`}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <EpisodeCard
              episode={item}
              onQueue={() => handleQueue(item)}
              onSkip={() => handleSkip(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
