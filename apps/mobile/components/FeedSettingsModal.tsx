import {
  View,
  Text,
  Modal,
  Switch,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useState, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import type { PodcastFeed, PodcastFeedSettings } from "@cliphy/shared";
import { brutalShadow, brutalShadowSm } from "../lib/theme";
import { getTheme } from "../lib/theme";
import { neon } from "@cliphy/shared";

interface Props {
  visible: boolean;
  feed: PodcastFeed | null;
  onClose: () => void;
  onSave: (settings: PodcastFeedSettings) => void;
}

export function FeedSettingsModal({ visible, feed, onClose, onSave }: Props) {
  const theme = getTheme();

  const [autoQueue, setAutoQueue] = useState(true);
  const [minMinutes, setMinMinutes] = useState("");
  const [maxMinutes, setMaxMinutes] = useState("");

  // Sync local state when the feed changes
  useEffect(() => {
    if (!feed) return;
    setAutoQueue(feed.autoQueue);
    setMinMinutes(feed.minDurationSeconds ? String(Math.round(feed.minDurationSeconds / 60)) : "");
    setMaxMinutes(feed.maxDurationSeconds ? String(Math.round(feed.maxDurationSeconds / 60)) : "");
  }, [feed]);

  function handleSave() {
    const min = parseInt(minMinutes, 10);
    const max = parseInt(maxMinutes, 10);
    onSave({
      autoQueue,
      minDurationSeconds: isNaN(min) ? null : min * 60,
      maxDurationSeconds: isNaN(max) ? null : max * 60,
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {!feed ? null : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1 bg-white dark:bg-[#1e1e1e]"
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View className="flex-row items-center justify-between mb-6">
              <Text
                className="text-xl font-bold text-[#111827] dark:text-white flex-1 mr-4"
                style={{ fontFamily: "DMSans" }}
                numberOfLines={1}
              >
                {feed.title}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                className="p-1"
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={24} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Auto-queue section */}
            <Text
              className="text-xs font-bold text-[#6b7280] dark:text-[#9ca3af] uppercase mb-3"
              style={{ fontFamily: "DMSans", letterSpacing: 1 }}
            >
              Auto-queue
            </Text>
            <View
              className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#f9fafb] dark:bg-[#282828] mb-6"
              style={brutalShadowSm()}
            >
              <View className="flex-row items-center justify-between">
                <Text
                  className="text-sm text-[#111827] dark:text-white flex-1 mr-3"
                  style={{ fontFamily: "DMSans" }}
                >
                  Automatically queue new episodes
                </Text>
                <Switch
                  value={autoQueue}
                  onValueChange={setAutoQueue}
                  trackColor={{ false: "#d1d5db", true: neon[500] }}
                  thumbColor="white"
                />
              </View>
            </View>

            {/* Duration filters section */}
            <Text
              className="text-xs font-bold text-[#6b7280] dark:text-[#9ca3af] uppercase mb-3"
              style={{ fontFamily: "DMSans", letterSpacing: 1 }}
            >
              Duration filters
            </Text>
            <View
              className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#f9fafb] dark:bg-[#282828] mb-2"
              style={brutalShadowSm()}
            >
              <View className="flex-row items-center justify-between mb-4">
                <Text
                  className="text-sm text-[#111827] dark:text-white flex-1 mr-3"
                  style={{ fontFamily: "DMSans" }}
                >
                  Skip episodes shorter than
                </Text>
                <TextInput
                  value={minMinutes}
                  onChangeText={setMinMinutes}
                  placeholder="No minimum"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="number-pad"
                  className="border-2 border-black dark:border-[#505050] rounded px-3 py-1.5 bg-white dark:bg-[#1e1e1e] text-[#111827] dark:text-white text-sm w-28 text-right"
                  style={{ fontFamily: "DMSans" }}
                />
              </View>

              <View className="flex-row items-center justify-between">
                <Text
                  className="text-sm text-[#111827] dark:text-white flex-1 mr-3"
                  style={{ fontFamily: "DMSans" }}
                >
                  Skip episodes longer than
                </Text>
                <TextInput
                  value={maxMinutes}
                  onChangeText={setMaxMinutes}
                  placeholder="No limit"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="number-pad"
                  className="border-2 border-black dark:border-[#505050] rounded px-3 py-1.5 bg-white dark:bg-[#1e1e1e] text-[#111827] dark:text-white text-sm w-28 text-right"
                  style={{ fontFamily: "DMSans" }}
                />
              </View>
            </View>
            <Text
              className="text-xs text-[#6b7280] dark:text-[#9ca3af] mb-8"
              style={{ fontFamily: "DMSans" }}
            >
              Enter duration in minutes. Leave blank for no limit.
            </Text>

            {/* Save button */}
            <TouchableOpacity
              onPress={handleSave}
              className="w-full items-center py-4 bg-black dark:bg-white border-2 border-black dark:border-white rounded-lg"
              style={brutalShadow()}
              accessibilityRole="button"
              accessibilityLabel="Save settings"
            >
              <Text
                className="font-bold text-white dark:text-black text-base"
                style={{ fontFamily: "DMSans" }}
              >
                Save
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}
