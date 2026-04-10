import { View, Text, Pressable, Alert, SafeAreaView } from "react-native";
import { useEffect, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { signOut } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { getUsage, createPortal } from "../../lib/api";
import { brutalShadowSm } from "../../lib/theme";
import { UpgradePrompt } from "../../components/UpgradePrompt";

export default function SettingsScreen() {
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<string>("free");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? "");
    });
    getUsage()
      .then((res) => setPlan(res.usage.plan))
      .catch(() => {});
  }, []);

  async function handleSignOut() {
    try {
      await signOut();
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-[#1e1e1e]">
      <View className="flex-1 px-6 pt-6">
        <Text
          className="text-2xl font-bold text-[#111827] dark:text-white mb-6"
          style={{ fontFamily: "DMSans" }}
        >
          Settings
        </Text>

        <View
          className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#f9fafb] dark:bg-[#282828] mb-6"
          style={brutalShadowSm()}
          accessibilityLabel={`Signed in as ${email}`}
        >
          <Text
            className="text-xs text-[#6b7280] dark:text-[#9ca3af] mb-1"
            style={{ fontFamily: "DMSans" }}
          >
            Signed in as
          </Text>
          <Text
            className="text-base font-bold text-[#111827] dark:text-white"
            style={{ fontFamily: "DMSans" }}
          >
            {email}
          </Text>
        </View>

        {plan === "free" ? (
          <UpgradePrompt />
        ) : (
          <Pressable
            onPress={async () => {
              try {
                const { url } = await createPortal();
                await WebBrowser.openBrowserAsync(url);
              } catch (err) {
                console.error("Portal error:", err);
              }
            }}
            className="px-4 py-3.5 border-2 border-black dark:border-[#505050] rounded-lg bg-[#f9fafb] dark:bg-[#282828] items-center mb-6"
            style={brutalShadowSm()}
            accessibilityRole="button"
            accessibilityLabel="Manage subscription"
          >
            <Text
              className="font-bold text-base text-[#111827] dark:text-white"
              style={{ fontFamily: "DMSans" }}
            >
              Manage Subscription
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={handleSignOut}
          className="px-4 py-3.5 border-2 border-black dark:border-[#505050] rounded-lg bg-red-100 dark:bg-red-950/30 items-center"
          style={brutalShadowSm()}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text
            className="font-bold text-base text-red-700 dark:text-red-400"
            style={{ fontFamily: "DMSans" }}
          >
            Sign Out
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
