import {
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { VideoDigestItem } from "@cliphy/shared";
import { neon } from "@cliphy/shared";
import {
  getVideoDigest,
  keepDigestItem,
  dismissDigestItem,
  getSettings,
  updateSettings,
} from "../lib/api";
import { brutalShadowSm } from "../lib/theme";

// The weekly digest: up to five new uploads from channels the person saves
// from, each summarized so it need not be watched. Keep one to add it to the
// library; dismiss it to take it off the list.

const showError = (err: unknown) =>
  Alert.alert("Error", err instanceof Error && err.message ? err.message : "Error");

export default function WeeklyDigestScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [digestDate, setDigestDate] = useState<string | null>(null);
  const [items, setItems] = useState<VideoDigestItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const [digest, settings] = await Promise.all([getVideoDigest(), getSettings()]);
      setEnabled(settings.weeklyDigest);
      setDigestDate(digest.digestDate);
      setItems(digest.items);
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function toggle(value: boolean) {
    setEnabled(value);
    try {
      await updateSettings({ weeklyDigest: value });
    } catch (err) {
      setEnabled(!value);
      showError(err);
    }
  }

  async function keep(item: VideoDigestItem) {
    setBusy(item.id);
    try {
      const res = await keepDigestItem(item.id);
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, keptClipId: res.clipId } : i)),
      );
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(item: VideoDigestItem) {
    const before = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await dismissDigestItem(item.id);
    } catch (err) {
      setItems(before);
      showError(err);
    }
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-[#1e1e1e]">
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
          accessibilityRole="header"
        >
          Weekly digest
        </Text>
        <View style={{ minWidth: 44 + 8 * 2 }} />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={neon[600]} />
        </View>
      ) : (
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
          <View className="flex-row items-center justify-between mb-6">
            <View className="flex-1 mr-3">
              <Text
                className="text-sm font-bold text-[#111827] dark:text-white"
                style={{ fontFamily: "DMSans" }}
              >
                Send me a weekly digest
              </Text>
              <Text
                className="text-xs text-[#6b7280] dark:text-[#9ca3af] mt-0.5"
                style={{ fontFamily: "DMSans" }}
              >
                Each Sunday: up to five new videos from channels you save from, summarized.
              </Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={toggle}
              trackColor={{ false: "#d1d5db", true: neon[500] }}
              thumbColor="white"
              accessibilityLabel="Send me a weekly digest"
            />
          </View>

          {items.length === 0 ? (
            <Text
              className="text-sm text-[#6b7280] dark:text-[#9ca3af]"
              style={{ fontFamily: "DMSans" }}
            >
              {!enabled
                ? "The digest is off."
                : digestDate
                  ? "Nothing left in this week's digest."
                  : "Your first digest is being made. Pull down to check in a few minutes."}
            </Text>
          ) : (
            <View className="gap-4">
              {digestDate ? (
                <Text
                  className="text-xs font-bold text-[#6b7280] dark:text-[#9ca3af] uppercase tracking-wide"
                  style={{ fontFamily: "DMSans" }}
                >
                  {`Week of ${digestDate}`}
                </Text>
              ) : null}
              {items.map((item) => (
                <DigestCard
                  key={item.id}
                  item={item}
                  busy={busy === item.id}
                  onKeep={() => keep(item)}
                  onDismiss={() => dismiss(item)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function DigestCard({
  item,
  busy,
  onKeep,
  onDismiss,
}: {
  item: VideoDigestItem;
  busy: boolean;
  onKeep: () => void;
  onDismiss: () => void;
}) {
  const kept = !!item.keptClipId;
  const points = item.summaryJson.keyPoints ?? [];
  return (
    <View
      className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#f9fafb] dark:bg-[#282828]"
      style={brutalShadowSm()}
    >
      <Text
        className="text-base font-bold text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
      >
        {item.title}
      </Text>
      {item.channel ? (
        <Text
          className="text-xs text-[#6b7280] dark:text-[#9ca3af] mt-0.5"
          style={{ fontFamily: "DMSans" }}
        >
          {item.channel}
        </Text>
      ) : null}
      {item.becauseTitle ? (
        <Text
          className="text-xs text-[#6b7280] dark:text-[#9ca3af] mt-0.5"
          style={{ fontFamily: "DMSans" }}
          numberOfLines={2}
        >
          {`Close to: ${item.becauseTitle}`}
        </Text>
      ) : null}

      <Text
        className="text-sm text-[#1f2937] dark:text-[#f0f0f0] leading-5 mt-3"
        style={{ fontFamily: "DMSans" }}
      >
        {item.summaryJson.summary}
      </Text>
      {points.length > 0 ? (
        <View className="gap-1.5 mt-3">
          {points.map((point, i) => (
            <View key={i} className="flex-row gap-2">
              <Text
                className="text-sm font-bold"
                style={{ fontFamily: "DMSans", color: neon[600] }}
              >
                {"•"}
              </Text>
              <Text
                className="text-sm text-[#1f2937] dark:text-[#f0f0f0] leading-5 flex-1"
                style={{ fontFamily: "DMSans" }}
              >
                {point}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="flex-row gap-2 mt-4">
        <CardButton
          label={kept ? "Kept" : busy ? "Keeping…" : "Keep"}
          onPress={onKeep}
          disabled={kept || busy}
        />
        <CardButton label="Watch" onPress={() => Linking.openURL(item.videoUrl)} />
        {!kept ? <CardButton label="Dismiss" onPress={onDismiss} disabled={busy} /> : null}
      </View>
    </View>
  );
}

function CardButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="flex-1 items-center justify-center border-2 border-black dark:border-[#505050] rounded-lg bg-white dark:bg-[#1e1e1e]"
      style={{ minHeight: 44, opacity: disabled ? 0.5 : 1 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text
        className="font-bold text-sm text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
