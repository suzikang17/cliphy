import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { desktopSection, type DesktopSection } from "../../lib/coach";
import { useCoach } from "../../lib/coachStore";
import { openMacSetup } from "../../lib/desktop";
import { ACCENT, FONT, LINE, useCoachTheme } from "./ui";

/** Room at the top for the window's own buttons, and for dragging it. */
const TITLE_STRIP = 34;
/** Screens were drawn for a phone; past this they stop widening. */
const CONTENT_WIDTH = 760;

const ITEMS: {
  section: DesktopSection;
  label: string;
  path: string;
  icon: "chatbubble-outline" | "folder-outline" | "list-outline";
}[] = [
  { section: "chat", label: "Chat", path: "/(tabs)/chat", icon: "chatbubble-outline" },
  { section: "projects", label: "Projects", path: "/(tabs)/projects", icon: "folder-outline" },
  { section: "upnext", label: "Up next", path: "/coach/upnext", icon: "list-outline" },
];

/** The Mac window: a side nav that stays put, with the current screen beside it. */
export function DesktopShell({ children }: { children: ReactNode }) {
  const t = useCoachTheme();
  const router = useRouter();
  const coach = useCoach();
  const active = desktopSection(usePathname());

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ height: TITLE_STRIP }} />
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View
          accessibilityRole="tablist"
          style={{
            width: 200,
            paddingHorizontal: 12,
            paddingTop: 6,
            paddingBottom: 14,
            borderRightWidth: LINE,
            borderRightColor: t.line,
          }}
        >
          <Text
            style={{
              fontFamily: FONT,
              fontSize: 18,
              fontWeight: "700",
              color: t.text,
              paddingHorizontal: 10,
              marginBottom: 14,
            }}
          >
            Cliphy
          </Text>

          {ITEMS.map((item) => {
            const on = active === item.section;
            const badge = item.section === "chat" ? coach.waiting : 0;
            return (
              <Pressable
                key={item.section}
                onPress={() => router.navigate(item.path as never)}
                accessibilityRole="tab"
                accessibilityLabel={badge ? `${item.label}, ${badge} waiting` : item.label}
                accessibilityState={{ selected: on }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 9,
                  marginBottom: 2,
                  borderRadius: 8,
                  borderWidth: LINE,
                  borderColor: on ? t.line : "transparent",
                  backgroundColor: on ? t.card : "transparent",
                }}
              >
                <Ionicons name={item.icon} size={18} color={on ? ACCENT : t.muted} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: FONT,
                    fontSize: 14,
                    fontWeight: on ? "700" : "500",
                    color: on ? t.text : t.muted,
                  }}
                >
                  {item.label}
                </Text>
                {badge > 0 ? (
                  <Text
                    style={{ fontFamily: FONT, fontSize: 12, fontWeight: "700", color: ACCENT }}
                  >
                    {badge}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}

          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => openMacSetup()}
            accessibilityRole="button"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 10,
              paddingVertical: 9,
            }}
          >
            <Ionicons name="phone-portrait-outline" size={18} color={t.muted} />
            <Text style={{ fontFamily: FONT, fontSize: 14, fontWeight: "500", color: t.muted }}>
              Messages
            </Text>
          </Pressable>
        </View>

        <View style={{ flex: 1, alignItems: "center" }}>
          <View style={{ flex: 1, width: "100%", maxWidth: CONTENT_WIDTH }}>{children}</View>
        </View>
      </View>
    </View>
  );
}
