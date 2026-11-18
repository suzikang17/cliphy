import { useEffect, type ReactNode } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { desktopSection, type DesktopSection } from "../../lib/coach";
import { refreshStrip, useCoach } from "../../lib/coachStore";
import { MAC_WINDOW, openMacSetup } from "../../lib/desktop";
import { FONT, LINE, useCoachTheme } from "./ui";

/** In the Mac window: room at the top for the window's own buttons, and for dragging it. */
const TITLE_STRIP = MAC_WINDOW ? 34 : 12;
/** Screens were drawn for a phone; past this they stop widening. */
const CONTENT_WIDTH = 760;
/** Below this width the nav moves to the bottom. */
const NARROW = 720;

const ITEMS: {
  section: DesktopSection;
  label: string;
  path: string;
  icon:
    | "chatbubble-outline"
    | "folder-outline"
    | "chatbubbles-outline"
    | "list-outline"
    | "settings-outline";
}[] = [
  { section: "chat", label: "Chat", path: "/(tabs)/chat", icon: "chatbubble-outline" },
  { section: "projects", label: "Projects", path: "/(tabs)/projects", icon: "folder-outline" },
  { section: "texts", label: "Texts", path: "/coach/threads", icon: "chatbubbles-outline" },
  { section: "upnext", label: "Up next", path: "/coach/upnext", icon: "list-outline" },
  { section: "settings", label: "Settings", path: "/coach/setup", icon: "settings-outline" },
];

/** The web build, in the Mac window or a browser: a side nav that stays put, with the current screen beside it. */
export function DesktopShell({ children }: { children: ReactNode }) {
  const t = useCoachTheme();
  const router = useRouter();
  const coach = useCoach();
  const pathname = usePathname();
  const active = desktopSection(pathname);
  // The counts follow the work: read again whenever the screen changes.
  useEffect(() => {
    void refreshStrip();
  }, [pathname, coach.status]);
  const badgeFor = (section: DesktopSection): number =>
    section === "chat"
      ? coach.waiting
      : section === "projects"
        ? coach.badges.projects
        : section === "upnext"
          ? coach.badges.upnext
          : 0;
  // A narrow window (a phone's browser) has no room for a side nav: the same
  // items go along the bottom instead.
  const narrow = useWindowDimensions().width < NARROW;

  if (narrow) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ flex: 1 }}>{children}</View>
        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: "row",
            borderTopWidth: LINE,
            borderTopColor: t.line,
            paddingVertical: 8,
          }}
        >
          {ITEMS.map((item) => {
            const on = active === item.section;
            return (
              <Pressable
                key={item.section}
                onPress={() => router.navigate(item.path as never)}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: on }}
                style={{ flex: 1, alignItems: "center" }}
              >
                <View>
                  <Ionicons name={item.icon} size={22} color={on ? t.accent : t.muted} />
                  {badgeFor(item.section) > 0 ? (
                    <Text
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -14,
                        fontFamily: FONT,
                        fontSize: 11,
                        fontWeight: "700",
                        color: t.accent,
                      }}
                    >
                      {badgeFor(item.section)}
                    </Text>
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
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

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
            const badge = badgeFor(item.section);
            return (
              <Pressable
                key={item.section}
                onPress={() => router.navigate(item.path as never)}
                accessibilityRole="tab"
                accessibilityLabel={badge ? `${item.label}, ${badge}` : item.label}
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
                <Ionicons name={item.icon} size={18} color={on ? t.accent : t.muted} />
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
                    style={{ fontFamily: FONT, fontSize: 12, fontWeight: "700", color: t.accent }}
                  >
                    {badge}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}

          <View style={{ flex: 1 }} />
          {/* On the Mac: who is captured from Messages. On cliphy.app: the
              website's own pages, where saved videos live. */}
          <Pressable
            onPress={() => (MAC_WINDOW ? openMacSetup() : window.location.assign("/dashboard"))}
            accessibilityRole="button"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 10,
              paddingVertical: 9,
            }}
          >
            <Ionicons
              name={MAC_WINDOW ? "phone-portrait-outline" : "grid-outline"}
              size={18}
              color={t.muted}
            />
            <Text style={{ fontFamily: FONT, fontSize: 14, fontWeight: "500", color: t.muted }}>
              {MAC_WINDOW ? "Messages" : "Library"}
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
