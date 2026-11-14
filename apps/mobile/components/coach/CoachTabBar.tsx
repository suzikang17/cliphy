import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { requestCapture } from "../../lib/captureBus";
import { useCoach } from "../../lib/coachStore";
import { ACCENT, FONT, LINE, hardShadow, useCoachTheme } from "./ui";

/**
 * Library on the left, a round plus in the middle, Chat on the right.
 * Each tab is an icon above a small label; the active one is shown by colour
 * only. The plus is the one heavy element. Chat appears only for accounts
 * that have the coach.
 */
export function CoachTabBar({ state, navigation }: BottomTabBarProps) {
  const t = useCoachTheme();
  const insets = useSafeAreaInsets();
  const coach = useCoach();
  const active = state.routes[state.index]?.name;

  const tab = (
    name: "index" | "chat",
    label: string,
    icon: "grid-outline" | "chatbubble-outline",
  ) => {
    const on = active === name;
    const badge = name === "chat" ? coach.waiting : 0;
    return (
      <Pressable
        onPress={() => navigation.navigate(name)}
        accessibilityRole="tab"
        accessibilityLabel={badge ? `${label}, ${badge} waiting` : label}
        accessibilityState={{ selected: on }}
        style={{ flex: 1, alignItems: "center", paddingVertical: 4 }}
      >
        <View>
          <Ionicons name={icon} size={24} color={on ? ACCENT : t.muted} />
          {badge > 0 ? (
            <View
              style={{
                position: "absolute",
                top: -5,
                right: -12,
                minWidth: 18,
                height: 18,
                paddingHorizontal: 4,
                borderRadius: 9,
                borderWidth: LINE,
                borderColor: t.line,
                backgroundColor: ACCENT,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontFamily: FONT, fontSize: 11, fontWeight: "700", color: "#fff" }}>
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          style={{
            fontFamily: FONT,
            fontSize: 11,
            marginTop: 3,
            fontWeight: on ? "700" : "500",
            color: on ? t.text : t.muted,
          }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: t.bg,
        borderTopWidth: LINE,
        borderTopColor: t.line,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 10),
        paddingHorizontal: 12,
      }}
    >
      {tab("index", "Library", "grid-outline")}
      <View style={{ width: 72, alignItems: "center" }}>
        <Pressable
          onPress={requestCapture}
          accessibilityRole="button"
          accessibilityLabel="Save something new"
          style={{
            width: 52,
            height: 52,
            marginTop: -30,
            borderRadius: 26,
            borderWidth: LINE,
            borderColor: t.line,
            backgroundColor: ACCENT,
            alignItems: "center",
            justifyContent: "center",
            ...hardShadow(t.line),
          }}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      </View>
      {coach.status === "on" ? (
        tab("chat", "Chat", "chatbubble-outline")
      ) : (
        <View style={{ flex: 1 }} />
      )}
    </View>
  );
}
