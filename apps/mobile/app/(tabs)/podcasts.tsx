import {
  View,
  Text,
  FlatList,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Platform,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import type { PodcastFeed, PodcastFeedSettings } from "@cliphy/shared";
import { neon } from "@cliphy/shared";
import {
  getPodcastFeeds,
  createPodcastFeed,
  updatePodcastFeed,
  deletePodcastFeed,
} from "../../lib/api";
import { PodcastFeedCard } from "../../components/PodcastFeedCard";
import { FeedSettingsModal } from "../../components/FeedSettingsModal";

export default function PodcastsScreen() {
  const router = useRouter();
  const [feeds, setFeeds] = useState<PodcastFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsModalFeed, setSettingsModalFeed] = useState<PodcastFeed | null>(null);
  const [showAndroidInput, setShowAndroidInput] = useState(false);
  const [androidInputUrl, setAndroidInputUrl] = useState("");

  useEffect(() => {
    loadFeeds();
  }, []);

  async function loadFeeds() {
    try {
      const data = await getPodcastFeeds();
      setFeeds(data);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to load podcasts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function promptAddFeed() {
    if (Platform.OS === "ios") {
      Alert.prompt(
        "Add Podcast",
        "Paste an RSS feed URL",
        async (url) => {
          if (!url?.trim()) return;
          try {
            const feed = await createPodcastFeed(url.trim());
            setFeeds((prev) => [...prev, feed]);
          } catch (err) {
            Alert.alert("Error", err instanceof Error ? err.message : "Failed to add podcast");
          }
        },
        "plain-text",
        "",
        "url",
      );
    } else {
      // Android: Alert.prompt is unavailable — show inline text input
      setAndroidInputUrl("");
      setShowAndroidInput(true);
    }
  }

  async function handleAndroidAdd() {
    const url = androidInputUrl.trim();
    if (!url) return;
    setShowAndroidInput(false);
    setAndroidInputUrl("");
    try {
      const feed = await createPodcastFeed(url);
      setFeeds((prev) => [...prev, feed]);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to add podcast");
    }
  }

  function handleDelete(feed: PodcastFeed) {
    Alert.alert("Remove podcast", `Remove "${feed.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setFeeds((prev) => prev.filter((f) => f.id !== feed.id));
          try {
            await deletePodcastFeed(feed.id);
          } catch {
            await loadFeeds();
          }
        },
      },
    ]);
  }

  async function handleSaveSettings(settings: PodcastFeedSettings) {
    if (!settingsModalFeed) return;
    const id = settingsModalFeed.id;
    setSettingsModalFeed(null);
    try {
      const updated = await updatePodcastFeed(id, settings);
      setFeeds((prev) => prev.map((f) => (f.id === id ? updated : f)));
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to save settings");
      await loadFeeds();
    }
  }

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-[#1e1e1e]">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={neon[600]} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-[#1e1e1e]">
      <FlatList
        data={feeds}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadFeeds();
            }}
            tintColor={neon[600]}
          />
        }
        ListHeaderComponent={
          <View className="mb-4">
            <View className="flex-row items-center justify-between mb-1">
              <Text
                className="text-2xl font-bold text-[#111827] dark:text-white"
                style={{ fontFamily: "DMSans" }}
              >
                Podcasts
              </Text>
              <Text
                onPress={promptAddFeed}
                className="text-sm font-bold text-[#111827] dark:text-white border-2 border-black dark:border-[#505050] px-3 py-1.5"
                style={{ fontFamily: "DMSans" }}
                accessibilityRole="button"
              >
                + Add
              </Text>
            </View>
            <Text
              className="text-sm text-[#6b7280] dark:text-[#9ca3af] mb-4"
              style={{ fontFamily: "DMSans" }}
            >
              Auto-queue new episodes from your favourite podcasts.
            </Text>

            {Platform.OS !== "ios" && showAndroidInput && (
              <View className="border-2 border-black dark:border-[#505050] rounded-lg p-3 bg-[#f9fafb] dark:bg-[#282828] mb-2">
                <TextInput
                  value={androidInputUrl}
                  onChangeText={setAndroidInputUrl}
                  placeholder="Paste RSS feed URL…"
                  placeholderTextColor="#6b7280"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="go"
                  onSubmitEditing={handleAndroidAdd}
                  className="text-sm text-[#111827] dark:text-white border-b-2 border-[#e5e7eb] dark:border-[#404040] pb-2 mb-3"
                  style={{ fontFamily: "DMSans" }}
                  autoFocus
                />
                <View className="flex-row justify-end gap-2">
                  <Text
                    onPress={() => {
                      setShowAndroidInput(false);
                      setAndroidInputUrl("");
                    }}
                    className="text-sm font-bold text-[#6b7280] dark:text-[#9ca3af] px-3 py-1.5"
                    style={{ fontFamily: "DMSans" }}
                    accessibilityRole="button"
                  >
                    Cancel
                  </Text>
                  <Text
                    onPress={handleAndroidAdd}
                    className="text-sm font-bold text-white dark:text-black bg-black dark:bg-white px-3 py-1.5 rounded"
                    style={{ fontFamily: "DMSans" }}
                    accessibilityRole="button"
                  >
                    Add
                  </Text>
                </View>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <View className="items-center py-16 border-2 border-dashed border-[#d1d5db] dark:border-[#404040] rounded-lg">
            <Text className="text-3xl mb-2">🎙️</Text>
            <Text
              className="text-sm font-bold text-[#111827] dark:text-white mb-1"
              style={{ fontFamily: "DMSans" }}
            >
              No podcasts yet.
            </Text>
            <Text
              className="text-sm text-[#6b7280] dark:text-[#9ca3af] text-center px-4"
              style={{ fontFamily: "DMSans" }}
            >
              Paste an RSS feed URL to get started.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <PodcastFeedCard
            feed={item}
            onPress={() => router.push(`/podcasts/${item.id}`)}
            onSettingsPress={() => setSettingsModalFeed(item)}
            onDeletePress={() => handleDelete(item)}
          />
        )}
      />

      <FeedSettingsModal
        visible={settingsModalFeed !== null}
        feed={settingsModalFeed}
        onClose={() => setSettingsModalFeed(null)}
        onSave={handleSaveSettings}
      />
    </SafeAreaView>
  );
}
