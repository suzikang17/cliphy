import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getTheme } from "../../lib/theme";
import { neon } from "@cliphy/shared";

export default function TabLayout() {
  const theme = getTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.surface },
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
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
