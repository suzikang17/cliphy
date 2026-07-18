import { View, Text, TouchableOpacity, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { PodcastFeed } from "@cliphy/shared";
import { brutalShadowSm } from "../lib/theme";

interface Props {
  feed: PodcastFeed;
  onPress: () => void;
  onSettingsPress: () => void;
  onDeletePress: () => void;
}

export function PodcastFeedCard({ feed, onPress, onSettingsPress, onDeletePress }: Props) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      className="border-2 border-black dark:border-[#505050] bg-white dark:bg-[#282828] mb-3 p-3 flex-row items-center rounded-lg"
      style={brutalShadowSm()}
      accessibilityRole="button"
      accessibilityLabel={feed.title}
    >
      {/* Artwork */}
      {feed.artworkUrl ? (
        <Image
          source={{ uri: feed.artworkUrl }}
          style={{ width: 48, height: 48, borderWidth: 2, borderColor: "#000" }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          className="bg-[#f3f4f6] dark:bg-[#1e1e1e]"
          style={{
            width: 48,
            height: 48,
            borderWidth: 2,
            borderColor: "#000",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="headset-outline" size={24} color="#6b7280" />
        </View>
      )}

      {/* Title + author */}
      <View className="flex-1 mx-3 min-w-0">
        <Text
          className="font-bold text-base text-[#111827] dark:text-white"
          style={{ fontFamily: "DMSans" }}
          numberOfLines={1}
        >
          {feed.title}
        </Text>
        {feed.author ? (
          <Text
            className="text-sm text-[#6b7280] dark:text-[#9ca3af]"
            style={{ fontFamily: "DMSans" }}
            numberOfLines={1}
          >
            {feed.author}
          </Text>
        ) : null}
      </View>

      {/* Actions */}
      <TouchableOpacity
        onPress={onDeletePress}
        className="p-1.5"
        accessibilityRole="button"
        accessibilityLabel="Remove feed"
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      >
        <Ionicons name="trash-outline" size={20} color="#6b7280" />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onSettingsPress}
        className="p-1.5"
        accessibilityRole="button"
        accessibilityLabel="Feed settings"
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      >
        <Ionicons name="settings-outline" size={20} color="#6b7280" />
      </TouchableOpacity>

      <Ionicons name="chevron-forward" size={18} color="#9ca3af" style={{ marginLeft: 4 }} />
    </TouchableOpacity>
  );
}
