import { Tabs } from "expo-router";
import { getTheme } from "../../lib/theme";
import { CoachTabBar } from "../../components/coach/CoachTabBar";

export default function TabLayout() {
  const theme = getTheme();

  return (
    <Tabs
      tabBar={(props) => <CoachTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.surface } }}
    >
      <Tabs.Screen name="index" options={{ title: "Library" }} />
      <Tabs.Screen name="chat" options={{ title: "Chat" }} />
      {/* Still routable, no longer tabs: reached from Library and the avatar. */}
      <Tabs.Screen name="subscriptions" options={{ href: null }} />
      <Tabs.Screen name="podcasts" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
