import { Text, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import type { Summary } from "@cliphy/shared";
import { sourceGlyph } from "@cliphy/shared";
import { brutalShadowSm } from "../lib/theme";
import { clock, voiceStatus } from "../lib/voiceNote";

/** A voice note or a written note in the Library: what it says, not a picture of it. */
export function NoteCard({ item, onArchive }: { item: Summary; onArchive?: (id: string) => void }) {
  const router = useRouter();
  const voice = item.sourceType === "voice";
  const seconds = item.sourceMetadata?.seconds;
  const status = voice ? voiceStatus(item) : null;
  const kind = voice
    ? `Voice note${typeof seconds === "number" ? ` · ${clock(seconds)}` : ""}`
    : "Note";
  // The summary once there is one; before that, the words themselves.
  const body = item.summaryJson?.summary || item.content?.trim();
  const titled = item.videoTitle && item.videoTitle !== "Voice note";

  return (
    <Pressable
      onPress={() => router.push(`/summary/${item.id}`)}
      onLongPress={onArchive ? () => onArchive(item.id) : undefined}
      className="border-2 border-black dark:border-[#505050] rounded-lg p-3 bg-[#f9fafb] dark:bg-[#282828]"
      style={brutalShadowSm()}
      accessibilityRole="button"
      accessibilityLabel={`${kind}${titled ? `: ${item.videoTitle}` : ""}${status ? `, ${status}` : ""}`}
    >
      <Text
        className="text-xs text-[#6b7280] dark:text-[#b4b4be] mb-0.5"
        style={{ fontFamily: "DMSans" }}
      >
        {sourceGlyph(item.sourceType)} {kind}
      </Text>
      {titled ? (
        <Text
          className="text-[15px] font-bold text-[#111827] dark:text-white"
          style={{ fontFamily: "DMSans", letterSpacing: -0.1 }}
          numberOfLines={2}
        >
          {item.videoTitle}
        </Text>
      ) : null}
      {status ? (
        <Text
          className="text-sm text-[#6b7280] dark:text-[#b4b4be] mt-1"
          style={{ fontFamily: "DMSans" }}
        >
          {status}
        </Text>
      ) : body ? (
        <Text
          className="text-sm text-[#374151] dark:text-[#d1d5db] mt-1"
          style={{ fontFamily: "DMSans" }}
          numberOfLines={3}
        >
          {body}
        </Text>
      ) : null}
      {item.tags && item.tags.length > 0 ? (
        <View className="flex-row flex-wrap gap-1 mt-2">
          {item.tags.slice(0, 3).map((tag) => (
            <View key={tag} className="bg-[#ede0f8] dark:bg-[#221028] px-2 py-0.5 rounded-md">
              <Text
                className="text-[11px] text-[#7a3fb0] dark:text-[#d5b8f0]"
                style={{ fontFamily: "DMSans" }}
              >
                {tag}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}
