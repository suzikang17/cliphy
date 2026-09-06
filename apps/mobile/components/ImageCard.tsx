import { Text, Pressable, Image } from "react-native";
import { useRouter } from "expo-router";
import type { Summary, ImageClipMetadata } from "@cliphy/shared";
import { brutalShadowSm } from "../lib/theme";

export function ImageCard({ item }: { item: Summary }) {
  const router = useRouter();
  const meta = (item.sourceMetadata ?? {}) as unknown as ImageClipMetadata;
  const processing = item.status === "pending" || item.status === "processing";

  return (
    <Pressable
      onPress={() => router.push(`/summary/${item.id}`)}
      className="border-2 border-black dark:border-[#505050] rounded-lg p-3 bg-[#f9fafb] dark:bg-[#282828]"
      style={brutalShadowSm()}
      accessibilityRole="button"
      accessibilityLabel="Image clip"
    >
      {item.heroImageUrl ? (
        <Image
          source={{ uri: item.heroImageUrl }}
          resizeMode="cover"
          className="w-full h-40 rounded-md border-2 border-black dark:border-[#505050] mb-2 bg-[#e5e7eb] dark:bg-[#1e1e1e]"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {meta.tweet ? (
        <Text
          className="text-xs text-[#6b7280] dark:text-[#9ca3af] mb-1"
          style={{ fontFamily: "DMSans" }}
        >
          🐦 @{meta.tweet.handle}
        </Text>
      ) : null}
      <Text
        className="text-sm text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
        numberOfLines={3}
      >
        {processing ? "Processing…" : (item.excerpt ?? item.content ?? "Image")}
      </Text>
    </Pressable>
  );
}
