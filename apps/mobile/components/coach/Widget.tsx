import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { ACCENT, FONT, LINE, useCoachTheme } from "./ui";

/** A row of widgets that wraps: side by side on a wide screen, stacked on a phone. */
export function WidgetGrid({ children, gap = 12 }: { children: ReactNode; gap?: number }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>{children}</View>;
}

/** One number with its label: a project at a glance. */
export function Tile({ value, label, strong }: { value: string; label: string; strong?: boolean }) {
  const t = useCoachTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flexGrow: 1,
        flexBasis: 130,
        borderWidth: LINE,
        borderColor: t.line,
        borderRadius: 10,
        backgroundColor: t.card,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontFamily: FONT,
          fontSize: 22,
          lineHeight: 26,
          fontWeight: "700",
          color: strong ? ACCENT : t.text,
        }}
      >
        {value}
      </Text>
      <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

/**
 * A titled box holding one part of a project. `wide` takes the whole row;
 * otherwise widgets sit two or three across when there is room.
 */
export function Widget({
  title,
  count,
  action,
  wide,
  children,
}: {
  title: string;
  /** Shown beside the title, e.g. how many rows are inside. */
  count?: number;
  /** A small control at the top right, e.g. an Edit link. */
  action?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const t = useCoachTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: wide ? "100%" : 300,
        minWidth: 0,
        maxWidth: "100%",
        borderWidth: LINE,
        borderColor: t.line,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
        <Text
          accessibilityRole="header"
          style={{
            flex: 1,
            fontFamily: FONT,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: t.muted,
          }}
        >
          {count === undefined ? title : `${title} · ${count}`}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** A small underlined word that does something, for a widget's corner. */
export function WidgetLink({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useCoachTheme();
  return (
    <Text
      onPress={onPress}
      accessibilityRole="button"
      style={{
        fontFamily: FONT,
        fontSize: 12,
        fontWeight: "700",
        color: t.text,
        textDecorationLine: "underline",
      }}
    >
      {label}
    </Text>
  );
}
