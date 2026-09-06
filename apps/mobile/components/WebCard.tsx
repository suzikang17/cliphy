import { Text, Pressable, Image, Linking } from "react-native";
import { useRouter } from "expo-router";
import type { Summary, WebClipMetadata } from "@cliphy/shared";
import { brutalShadowSm } from "../lib/theme";
import { sourceGlyph } from "../lib/clipGlyph";

export function WebCard({ item }: { item: Summary }) {
  const router = useRouter();
  const meta = (item.sourceMetadata ?? {}) as unknown as WebClipMetadata;

  function handlePress() {
    if (meta.kind === "article") router.push(`/summary/${item.id}`);
    else if (item.sourceUrl) Linking.openURL(item.sourceUrl);
  }

  return (
    <Pressable
      onPress={handlePress}
      className="border-2 border-black dark:border-[#505050] rounded-lg p-3 bg-[#f9fafb] dark:bg-[#282828]"
      style={brutalShadowSm()}
      accessibilityRole="button"
      accessibilityLabel={item.videoTitle ?? item.sourceUrl ?? "Web clip"}
    >
      {item.heroImageUrl ? (
        <Image
          source={{ uri: item.heroImageUrl }}
          resizeMode="cover"
          style={{ aspectRatio: 16 / 10 }}
          className="w-full rounded-md border-2 border-black dark:border-[#505050] mb-2 bg-[#e5e7eb] dark:bg-[#1e1e1e]"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <Text
        className="text-base font-bold text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
        numberOfLines={2}
      >
        {item.videoTitle ?? item.sourceUrl}
      </Text>
      <Text
        className="text-xs text-[#6b7280] dark:text-[#9ca3af] mt-0.5"
        style={{ fontFamily: "DMSans" }}
        numberOfLines={1}
      >
        {sourceGlyph(item.sourceType)} {meta.siteName ?? "Link"}
        {meta.readingTimeMin ? ` · ${meta.readingTimeMin} min read` : ""}
      </Text>
      {item.excerpt ? (
        <Text
          className="text-sm text-[#374151] dark:text-[#d1d5db] mt-1"
          style={{ fontFamily: "DMSans" }}
          numberOfLines={2}
        >
          {item.excerpt}
        </Text>
      ) : null}
    </Pressable>
  );
}
