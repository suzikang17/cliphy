import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { requestCapture } from "../../lib/captureBus";
import { useCoach } from "../../lib/coachStore";
import { FONT, LINE, hardShadow, useCoachTheme } from "./ui";

/**
 * Library on the left, Chat as the round button in the middle, Projects on
 * the right. Chat is where everything arrives, so it has the one heavy
 * element and carries the count of things waiting on an answer. Accounts
 * without the coach get a plus there instead, which saves something new.
 */
export function CoachTabBar({ state, navigation }: BottomTabBarProps) {
  const t = useCoachTheme();
  const insets = useSafeAreaInsets();
  const coach = useCoach();
  const active = state.routes[state.index]?.name;

  const tab = (
    name: "index" | "projects" | "chat",
    label: string,
    icon: "grid-outline" | "folder-outline" | "chatbubble-outline",
  ) => {
    const on = active === name;
    const badge = name === "chat" ? coach.waiting : name === "projects" ? coach.badges.projects : 0;
    return (
      <Pressable
        onPress={() => navigation.navigate(name)}
        accessibilityRole="tab"
        accessibilityLabel={badge ? `${label}, ${badge}` : label}
        accessibilityState={{ selected: on }}
        style={{ flex: 1, alignItems: "center", paddingVertical: 4 }}
      >
        <View>
          <Ionicons name={icon} size={24} color={on ? t.accent : t.muted} />
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
                backgroundColor: t.fill,
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

  const coachOn = coach.status === "on";
  const onChat = active === "chat";

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
      {/* Equal halves keep the middle button in the middle whatever sits on each side. */}
      <View style={{ flex: 1, flexDirection: "row" }}>
        {tab("index", "Library", "grid-outline")}
      </View>
      <View style={{ width: 72, alignItems: "center" }}>
        <Pressable
          onPress={() => {
            if (coachOn) {
              navigation.navigate("chat");
              return;
            }
            // Without the coach the middle button saves something new. The
            // sheet belongs to Library: go there first, then open it.
            if (active !== "index") {
              navigation.navigate("index");
              setTimeout(requestCapture, 80);
            } else {
              requestCapture();
            }
          }}
          accessibilityRole={coachOn ? "tab" : "button"}
          accessibilityState={coachOn ? { selected: onChat } : undefined}
          accessibilityLabel={
            coachOn
              ? coach.waiting
                ? `Chat, ${coach.waiting} waiting`
                : "Chat"
              : "Save something new"
          }
          style={{
            width: 52,
            height: 52,
            marginTop: -30,
            borderRadius: 26,
            borderWidth: LINE,
            borderColor: t.line,
            backgroundColor: t.fill,
            alignItems: "center",
            justifyContent: "center",
            ...hardShadow(t.line),
          }}
        >
          <Ionicons
            name={coachOn ? (onChat ? "chatbubble" : "chatbubble-outline") : "add"}
            size={coachOn ? 24 : 28}
            color="#fff"
          />
          {coachOn && coach.waiting > 0 ? (
            <View
              style={{
                position: "absolute",
                top: -4,
                right: -6,
                minWidth: 20,
                height: 20,
                paddingHorizontal: 4,
                borderRadius: 10,
                borderWidth: LINE,
                borderColor: t.line,
                backgroundColor: t.bg,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontFamily: FONT, fontSize: 11, fontWeight: "700", color: t.text }}>
                {coach.waiting}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {coachOn ? tab("projects", "Projects", "folder-outline") : null}
      </View>
    </View>
  );
}
