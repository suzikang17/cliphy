import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import type { Subscription, SubscriptionType } from "@cliphy/shared";
import {
  getSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  getGoogleStatus,
  getGoogleConnectUrl,
  disconnectGoogle,
  getUsage,
} from "../../lib/api";
import { brutalShadowSm, getTheme } from "../../lib/theme";
import { neon } from "@cliphy/shared";

const YOUTUBE_NON_CHANNEL_PATHS =
  /^\/(feed|trending|gaming|music|live|premium|account|results|shorts|watch|embed)\b/;

function inferType(url: string): SubscriptionType | null {
  if (/[?&]list=/.test(url) || /\/playlist\b/.test(url)) return "playlist";
  if (/\/@|\/channel\/|\/c\/|\/user\//.test(url)) return "channel";
  try {
    const { pathname } = new URL(url);
    if (
      /youtube\.com/.test(url) &&
      /^\/[^/?#\s]+$/.test(pathname) &&
      !YOUTUBE_NON_CHANNEL_PATHS.test(pathname)
    )
      return "channel";
  } catch {
    // invalid URL
  }
  return null;
}

const TYPE_LABELS: Record<SubscriptionType, string> = {
  channel: "Channel",
  playlist: "Playlist",
  watch_later: "Watch Later",
  liked: "Liked Videos",
};

export default function SubscriptionsScreen() {
  const theme = getTheme();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const [subsRes, googleRes, usageRes] = await Promise.all([
        getSubscriptions(),
        getGoogleStatus(),
        getUsage(),
      ]);
      setSubscriptions(subsRes.subscriptions);
      setGoogleConnected(googleRes.connected);
      setIsPro(usageRes.usage.plan === "pro");
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleAdd() {
    const url = addUrl.trim();
    if (!url) return;
    const type = inferType(url);
    if (!type) {
      Alert.alert("Invalid URL", "Paste a YouTube channel or playlist URL");
      return;
    }
    setAddLoading(true);
    try {
      const res = await createSubscription({ type, sourceUrl: url });
      setSubscriptions((prev) => [...prev, res.subscription]);
      setAddUrl("");
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to add subscription");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleAddWatchLater() {
    setAddLoading(true);
    try {
      const res = await createSubscription({ type: "watch_later" });
      setSubscriptions((prev) => [...prev, res.subscription]);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to add Watch Later");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleToggle(id: string, newActive: boolean) {
    setSubscriptions((prev) => prev.map((s) => (s.id === id ? { ...s, isActive: newActive } : s)));
    try {
      await updateSubscription(id, { isActive: newActive });
    } catch {
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isActive: !newActive } : s)),
      );
    }
  }

  async function handleDelete(id: string, name: string) {
    Alert.alert("Delete subscription", `Remove "${name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setSubscriptions((prev) => prev.filter((s) => s.id !== id));
          try {
            await deleteSubscription(id);
          } catch {
            await load();
          }
        },
      },
    ]);
  }

  async function handleConnectGoogle() {
    setConnectingGoogle(true);
    try {
      const { url } = await getGoogleConnectUrl();
      await WebBrowser.openBrowserAsync(url);
      // Reload status after browser closes
      const res = await getGoogleStatus();
      setGoogleConnected(res.connected);
      if (res.connected) {
        const subsRes = await getSubscriptions();
        setSubscriptions(subsRes.subscriptions);
      }
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to connect Google");
    } finally {
      setConnectingGoogle(false);
    }
  }

  async function handleDisconnectGoogle() {
    Alert.alert("Disconnect Google", "This will also remove your Watch Later subscription.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          try {
            await disconnectGoogle();
            setGoogleConnected(false);
            setSubscriptions((prev) => prev.filter((s) => s.type !== "watch_later"));
          } catch (err) {
            Alert.alert("Error", err instanceof Error ? err.message : "Failed to disconnect");
          }
        },
      },
    ]);
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

  const hasWatchLater = subscriptions.some((s) => s.type === "watch_later");

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-[#1e1e1e]">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
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
      >
        <Text
          className="text-2xl font-bold text-[#111827] dark:text-white mb-1"
          style={{ fontFamily: "DMSans" }}
        >
          Auto-Subscriptions
        </Text>
        <Text
          className="text-sm text-[#6b7280] dark:text-[#9ca3af] mb-6"
          style={{ fontFamily: "DMSans" }}
        >
          Auto-queue new videos from channels, playlists, and Watch Later.
        </Text>

        {!isPro && (
          <View
            className="border-2 border-amber-400 dark:border-amber-600 rounded-lg p-4 bg-amber-50 dark:bg-amber-950/30 mb-6"
            style={brutalShadowSm()}
          >
            <Text
              className="text-sm font-bold text-[#111827] dark:text-white mb-1"
              style={{ fontFamily: "DMSans" }}
            >
              Pro feature
            </Text>
            <Text
              className="text-sm text-[#6b7280] dark:text-[#9ca3af]"
              style={{ fontFamily: "DMSans" }}
            >
              Upgrade to Cliphy Pro to use auto-subscriptions.
            </Text>
          </View>
        )}

        {/* Add URL input */}
        <View
          className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#f9fafb] dark:bg-[#282828] mb-4"
          style={brutalShadowSm()}
        >
          <Text
            className="text-sm font-bold text-[#111827] dark:text-white mb-3"
            style={{ fontFamily: "DMSans" }}
          >
            Add Channel or Playlist
          </Text>
          <TextInput
            value={addUrl}
            onChangeText={setAddUrl}
            placeholder="https://youtube.com/@channel or /playlist?list=…"
            placeholderTextColor={theme.textMuted}
            editable={isPro && !addLoading}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            className="border-2 border-black dark:border-[#505050] rounded-lg px-3 py-2.5 bg-white dark:bg-[#1e1e1e] text-[#111827] dark:text-white text-sm mb-3"
            style={{ fontFamily: "DMSans" }}
          />
          <Pressable
            onPress={handleAdd}
            disabled={!isPro || addLoading || !addUrl.trim()}
            className="items-center py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-white dark:bg-[#1e1e1e]"
            style={({ pressed }) =>
              pressed ? { transform: [{ translateX: 2 }, { translateY: 2 }] } : brutalShadowSm()
            }
            accessibilityRole="button"
          >
            <Text
              className="font-bold text-sm text-[#111827] dark:text-white"
              style={{ fontFamily: "DMSans", opacity: !isPro || !addUrl.trim() ? 0.4 : 1 }}
            >
              {addLoading ? "Adding…" : "Add"}
            </Text>
          </Pressable>
        </View>

        {/* Watch Later / Google section */}
        <View
          className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#f9fafb] dark:bg-[#282828] mb-6"
          style={brutalShadowSm()}
        >
          <Text
            className="text-sm font-bold text-[#111827] dark:text-white mb-1"
            style={{ fontFamily: "DMSans" }}
          >
            Watch Later
          </Text>
          <Text
            className="text-xs text-[#6b7280] dark:text-[#9ca3af] mb-3"
            style={{ fontFamily: "DMSans" }}
          >
            {googleConnected
              ? "Google account connected"
              : "Connect Google to auto-queue your Watch Later list"}
          </Text>

          {googleConnected ? (
            <View className="flex-row gap-2">
              {!hasWatchLater && isPro && (
                <Pressable
                  onPress={handleAddWatchLater}
                  disabled={addLoading}
                  className="flex-1 items-center py-2.5 border-2 border-black dark:border-[#505050] rounded-lg bg-white dark:bg-[#1e1e1e]"
                  style={({ pressed }) =>
                    pressed
                      ? { transform: [{ translateX: 2 }, { translateY: 2 }] }
                      : brutalShadowSm()
                  }
                  accessibilityRole="button"
                >
                  <Text
                    className="font-bold text-sm text-[#111827] dark:text-white"
                    style={{ fontFamily: "DMSans" }}
                  >
                    Enable
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={handleDisconnectGoogle}
                className="flex-1 items-center py-2.5 border-2 border-red-400 dark:border-red-700 rounded-lg bg-red-50 dark:bg-red-950/30"
                style={({ pressed }) =>
                  pressed ? { transform: [{ translateX: 2 }, { translateY: 2 }] } : brutalShadowSm()
                }
                accessibilityRole="button"
              >
                <Text
                  className="font-bold text-sm text-red-600 dark:text-red-400"
                  style={{ fontFamily: "DMSans" }}
                >
                  Disconnect Google
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={handleConnectGoogle}
              disabled={!isPro || connectingGoogle}
              className="items-center py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-white dark:bg-[#1e1e1e]"
              style={({ pressed }) =>
                pressed ? { transform: [{ translateX: 2 }, { translateY: 2 }] } : brutalShadowSm()
              }
              accessibilityRole="button"
            >
              <Text
                className="font-bold text-sm text-[#111827] dark:text-white"
                style={{ fontFamily: "DMSans", opacity: !isPro ? 0.4 : 1 }}
              >
                {connectingGoogle ? "Opening…" : "Connect Google"}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Subscriptions list */}
        {subscriptions.length === 0 ? (
          <View className="items-center py-12 border-2 border-dashed border-[#d1d5db] dark:border-[#404040] rounded-lg">
            <Text className="text-3xl mb-2">📡</Text>
            <Text
              className="text-sm font-bold text-[#111827] dark:text-white mb-1"
              style={{ fontFamily: "DMSans" }}
            >
              No subscriptions yet
            </Text>
            <Text
              className="text-sm text-[#6b7280] dark:text-[#9ca3af] text-center px-4"
              style={{ fontFamily: "DMSans" }}
            >
              Add a channel or playlist above to get started.
            </Text>
          </View>
        ) : (
          <View>
            <Text
              className="text-xs font-bold text-[#6b7280] dark:text-[#9ca3af] uppercase mb-2"
              style={{ fontFamily: "DMSans", letterSpacing: 1 }}
            >
              Your subscriptions ({subscriptions.length})
            </Text>
            <View className="gap-2">
              {subscriptions.map((sub) => (
                <SubscriptionRow
                  key={sub.id}
                  subscription={sub}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SubscriptionRow({
  subscription: sub,
  onToggle,
  onDelete,
}: {
  subscription: Subscription;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const typeBadgeColors: Record<SubscriptionType, string> = {
    channel: "bg-blue-100 dark:bg-blue-900/30",
    playlist: "bg-purple-100 dark:bg-purple-900/30",
    watch_later: "bg-amber-100 dark:bg-amber-900/30",
    liked: "bg-rose-100 dark:bg-rose-900/30",
  };
  const typeBadgeText: Record<SubscriptionType, string> = {
    channel: "text-blue-700 dark:text-blue-300",
    playlist: "text-purple-700 dark:text-purple-300",
    watch_later: "text-amber-700 dark:text-amber-300",
    liked: "text-rose-700 dark:text-rose-300",
  };

  return (
    <View
      className="flex-row items-center gap-3 px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-[#f9fafb] dark:bg-[#282828]"
      style={brutalShadowSm()}
    >
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-2 flex-wrap">
          <View className={`px-2 py-0.5 rounded-full ${typeBadgeColors[sub.type]}`}>
            <Text
              className={`text-[10px] font-bold ${typeBadgeText[sub.type]}`}
              style={{ fontFamily: "DMSans" }}
            >
              {TYPE_LABELS[sub.type]}
            </Text>
          </View>
          <Text
            className="text-sm font-bold text-[#111827] dark:text-white flex-shrink"
            style={{ fontFamily: "DMSans" }}
            numberOfLines={1}
          >
            {sub.sourceName}
          </Text>
        </View>
      </View>

      <Switch
        value={sub.isActive}
        onValueChange={(val) => onToggle(sub.id, val)}
        trackColor={{ false: "#d1d5db", true: neon[500] }}
        thumbColor="white"
      />

      <Pressable
        onPress={() => onDelete(sub.id, sub.sourceName)}
        className="p-1"
        accessibilityRole="button"
        accessibilityLabel={`Delete ${sub.sourceName}`}
      >
        <Text className="text-[#9ca3af] text-base">✕</Text>
      </Pressable>
    </View>
  );
}
