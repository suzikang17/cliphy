import { View, Text, Pressable } from "react-native";
import { neon, tagPath } from "@cliphy/shared";

/**
 * AI-suggested tags for a clip. Tap the chip to accept ("+ tag"), tap ✕ to dismiss.
 * Dashed outline distinguishes suggestions from applied (solid) tags.
 */
export function SuggestedTags({
  tags,
  onAccept,
  onDismiss,
}: {
  tags: string[];
  onAccept: (tag: string) => void;
  onDismiss: (tag: string) => void;
}) {
  if (tags.length === 0) return null;

  return (
    <View className="flex-row flex-wrap gap-1.5">
      {tags.map((tag) => {
        const label = tagPath(tag).join(" › ");
        return (
          <View
            key={tag}
            className="flex-row items-center rounded-lg border border-dashed"
            style={{ borderColor: neon[600] }}
          >
            <Pressable
              onPress={() => onAccept(tag)}
              className="pl-2.5 pr-1 py-1"
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Add suggested tag ${label}`}
            >
              <Text
                className="text-xs font-medium"
                style={{ fontFamily: "DMSans", color: neon[600] }}
              >
                + {label}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onDismiss(tag)}
              className="pl-1 pr-2 py-1"
              hitSlop={{ top: 8, bottom: 8, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss suggested tag ${label}`}
            >
              <Text
                className="text-xs text-[#6b7280] dark:text-[#9ca3af]"
                style={{ fontFamily: "DMSans" }}
              >
                ✕
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
