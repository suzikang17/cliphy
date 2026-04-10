import { Tabs } from "expo-router";
import { getTheme } from "../../lib/theme";
import { neon } from "@cliphy/shared";

export default function TabLayout() {
  const theme = getTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: neon[600],
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.borderSoft,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontFamily: "DMSans",
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Queue",
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
        }}
      />
    </Tabs>
  );
}
