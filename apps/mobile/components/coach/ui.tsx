import type { ReactNode } from "react";
import { Pressable, Text, View, useColorScheme, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, neon } from "@cliphy/shared";

// The coach's look: light neo-brutalist. Outlines are 1.5px. A hard 2px shadow
// is used only on bot message cards and the plus button. Lists are flat rows
// separated by a hairline. Nothing is smaller than 11px.

export const LINE = 1.5;
export const FONT = "DMSans";
/** Filled buttons and active states: dark enough for white text. */
export const ACCENT = neon[700];

export function useCoachTheme() {
  const dark = useColorScheme() === "dark";
  const c = dark ? colors.dark : colors.light;
  return {
    dark,
    bg: c.surface,
    card: dark ? c.surfaceSecondary : c.accentSurface,
    text: c.text,
    muted: c.textMuted,
    hairline: c.borderSoft,
    line: dark ? c.borderHard : "#000000",
    due: dark ? "#fbbf24" : "#92400e",
    ok: dark ? "#4ade80" : "#166534",
  };
}

export function hardShadow(line: string, offset = 2): ViewStyle {
  return {
    shadowColor: line,
    shadowOffset: { width: offset, height: offset },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: offset,
  };
}

/** A pushed page: back arrow, title, one optional line under it. */
export function Page({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  const t = useCoachTheme();
  const router = useRouter();
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.bg }}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 12,
          borderBottomWidth: LINE,
          borderBottomColor: t.line,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={{ flexDirection: "row", alignItems: "center" }}
        >
          <Text style={{ fontFamily: FONT, fontSize: 22, fontWeight: "700", color: t.text }}>
            ‹ {title}
          </Text>
        </Pressable>
        {sub ? (
          <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 2 }}>
            {sub}
          </Text>
        ) : null}
      </View>
      {children}
    </SafeAreaView>
  );
}

export function SectionLabel({ children }: { children: string }) {
  const t = useCoachTheme();
  return (
    <Text
      style={{
        fontFamily: FONT,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: t.muted,
        marginTop: 18,
        marginBottom: 2,
      }}
    >
      {children}
    </Text>
  );
}

/** A flat list row: a title, at most one short detail, and one small word at the right. */
export function Row({
  title,
  detail,
  right,
  rightColor,
  left,
  onPress,
  dim,
}: {
  title: string;
  detail?: string;
  right?: string;
  rightColor?: string;
  left?: ReactNode;
  onPress?: () => void;
  dim?: boolean;
}) {
  const t = useCoachTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: t.hairline,
        opacity: dim ? 0.55 : 1,
      }}
    >
      {left}
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT, fontSize: 15, fontWeight: "500", color: t.text }}>
          {title}
        </Text>
        {detail ? (
          <Text style={{ fontFamily: FONT, fontSize: 12, color: t.muted, marginTop: 1 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {right ? (
        <Text
          style={{
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: "700",
            color: rightColor ?? t.muted,
          }}
        >
          {right}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A small rounded button. `primary` is filled; `chosen` shows it was the one tapped. */
export function QuickButton({
  label,
  onPress,
  primary,
  chosen,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  chosen?: boolean;
  disabled?: boolean;
}) {
  const t = useCoachTheme();
  const filled = primary || chosen;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(chosen) }}
      hitSlop={6}
      style={{
        paddingHorizontal: 13,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: LINE,
        borderColor: t.line,
        backgroundColor: filled ? ACCENT : "transparent",
        opacity: disabled && !chosen ? 0.4 : 1,
        ...(primary ? hardShadow(t.line, 1.5) : {}),
      }}
    >
      <Text
        style={{
          fontFamily: FONT,
          fontSize: 13,
          fontWeight: filled ? "700" : "500",
          color: filled ? "#ffffff" : t.text,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A bot message card: the one place in the thread that carries the hard shadow. */
export function BotCard({ children }: { children: ReactNode }) {
  const t = useCoachTheme();
  return (
    <View
      style={{
        backgroundColor: t.card,
        borderWidth: LINE,
        borderColor: t.line,
        borderRadius: 10,
        paddingHorizontal: 13,
        paddingVertical: 11,
        marginBottom: 10,
        marginRight: 28,
        ...hardShadow(t.line),
      }}
    >
      {children}
    </View>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const t = useCoachTheme();
  return (
    <Text
      style={{ fontFamily: FONT, fontSize: 15, lineHeight: 21, color: muted ? t.muted : t.text }}
    >
      {children}
    </Text>
  );
}
