import { View, Text, Pressable, Image } from "react-native";
import { useRouter } from "expo-router";
import type { Summary, TweetClipMetadata } from "@cliphy/shared";
import { brutalShadowSm } from "../lib/theme";

export function TweetCard({
  item,
  onArchive,
}: {
  item: Summary;
  onArchive?: (id: string) => void;
}) {
  const router = useRouter();
  const meta = (item.sourceMetadata ?? {}) as unknown as TweetClipMetadata;
  const threadCount = meta.threadTweetIds?.length ?? 1;

  return (
    <Pressable
      onPress={() => router.push(`/summary/${item.id}`)}
      onLongPress={onArchive ? () => onArchive(item.id) : undefined}
      className="border-2 border-black dark:border-[#505050] rounded-lg p-3 bg-[#f9fafb] dark:bg-[#282828]"
      style={brutalShadowSm()}
      accessibilityRole="button"
      accessibilityLabel={`Tweet by ${meta.handle}`}
    >
      <View className="flex-row items-center gap-2 mb-1">
        {meta.avatarUrl ? (
          <Image
            source={{ uri: meta.avatarUrl }}
            className="w-8 h-8 rounded-full border border-black dark:border-[#505050]"
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <Text
          className="text-sm font-bold text-[#111827] dark:text-white"
          style={{ fontFamily: "DMSans" }}
          numberOfLines={1}
        >
          @{meta.handle}
        </Text>
        {threadCount > 1 ? (
          <Text
            className="text-xs text-[#6b7280] dark:text-[#9ca3af]"
            style={{ fontFamily: "DMSans" }}
          >
            🧵 {threadCount}
          </Text>
        ) : null}
      </View>
      <Text
        className="text-sm text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
        numberOfLines={5}
      >
        {item.content}
      </Text>
      {meta.media && meta.media.length > 0 && meta.media[0].previewUrl ? (
        <Image
          source={{ uri: meta.media[0].previewUrl }}
          resizeMode="cover"
          style={{ aspectRatio: 4 / 3 }}
          className="w-full rounded-md border-2 border-black dark:border-[#505050] mt-2 bg-[#e5e7eb] dark:bg-[#1e1e1e]"
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </Pressable>
  );
}
