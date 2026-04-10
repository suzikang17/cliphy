import { View, Text, Pressable, Alert } from "react-native";
import { useEffect, useState } from "react";
import { signOut } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { brutalShadowSm } from "../../lib/theme";

export default function SettingsScreen() {
  const [email, setEmail] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? "");
    });
  }, []);

  async function handleSignOut() {
    try {
      await signOut();
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <View className="flex-1 bg-white dark:bg-[#1e1e1e] pt-16 px-6">
      <Text
        className="text-2xl font-bold text-[#111827] dark:text-white mb-6"
        style={{ fontFamily: "DMSans" }}
      >
        Settings
      </Text>

      <View
        className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#f9fafb] dark:bg-[#282828] mb-6"
        style={brutalShadowSm()}
      >
        <Text className="text-xs text-[#6b7280] mb-1" style={{ fontFamily: "DMSans" }}>
          Signed in as
        </Text>
        <Text
          className="text-sm font-bold text-[#111827] dark:text-white"
          style={{ fontFamily: "DMSans" }}
        >
          {email}
        </Text>
      </View>

      <Pressable
        onPress={handleSignOut}
        className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-red-100 dark:bg-red-950/30 items-center"
        style={brutalShadowSm()}
      >
        <Text
          className="font-bold text-sm text-red-700 dark:text-red-400"
          style={{ fontFamily: "DMSans" }}
        >
          Sign Out
        </Text>
      </Pressable>
    </View>
  );
}
