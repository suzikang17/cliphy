import { Image, Pressable, Text, View } from "react-native";
import type { InboundMessage } from "@cliphy/shared";
import { shortDay } from "../../lib/coach";
import { ACCENT, FONT, LINE, useCoachTheme } from "./ui";

/** A square tick box. `crossed` is the "not done" state. */
export function Tick({ checked, crossed }: { checked: boolean; crossed?: boolean }) {
  const t = useCoachTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 5,
        borderWidth: LINE,
        borderColor: t.line,
        backgroundColor: checked ? ACCENT : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {crossed ? (
        <Text style={{ fontFamily: FONT, fontSize: 13, fontWeight: "700", color: t.muted }}>–</Text>
      ) : null}
    </View>
  );
}

/** What someone sent: the day, the words and any pictures. Tappable when it can be picked. */
export function MessageRow({
  message,
  checked,
  onPress,
  compact,
}: {
  message: InboundMessage;
  /** Shows a tick box when set. */
  checked?: boolean;
  onPress?: () => void;
  /** Inside another row: no divider, smaller. */
  compact?: boolean;
}) {
  const t = useCoachTheme();
  const pictures = message.attachments.filter((a) => a.url);
  const who = message.direction === "out" ? "Me · " : "";
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={checked === undefined ? undefined : "checkbox"}
      accessibilityState={checked === undefined ? undefined : { checked }}
      accessibilityLabel={message.text.trim() || "Photo"}
      style={{
        flexDirection: "row",
        gap: 12,
        paddingVertical: compact ? 4 : 11,
        borderBottomWidth: compact ? 0 : 1,
        borderBottomColor: t.hairline,
      }}
    >
      {checked === undefined ? null : <Tick checked={checked} />}
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT, fontSize: 11, color: t.muted }}>
          {who}
          {shortDay(message.sentAt)}
        </Text>
        {message.text.trim() ? (
          <Text
            style={{
              fontFamily: FONT,
              fontSize: compact ? 13 : 15,
              lineHeight: compact ? 18 : 21,
              color: compact ? t.muted : t.text,
              marginTop: 1,
            }}
          >
            {message.text.trim()}
          </Text>
        ) : null}
        {pictures.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {pictures.map((a) => (
              <Image
                key={a.storagePath}
                source={{ uri: a.url as string }}
                accessibilityLabel="Picture she sent"
                style={{
                  width: compact ? 64 : 84,
                  height: compact ? 64 : 84,
                  borderRadius: 6,
                  borderWidth: LINE,
                  borderColor: t.line,
                  backgroundColor: t.hairline,
                }}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
