import { View, Text, Pressable } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { neon } from "@cliphy/shared";
import { createCheckout } from "../lib/api";
import { brutalShadowSm } from "../lib/theme";
import { useState } from "react";

export function UpgradePrompt() {
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    setLoading(true);
    try {
      const { url } = await createCheckout();
      await WebBrowser.openBrowserAsync(url);
    } catch (err) {
      console.error("Checkout error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View
      className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#ede0f8] dark:bg-[#1e0030] mb-6"
      style={brutalShadowSm()}
    >
      <Text
        className="text-sm font-bold text-[#111827] dark:text-white mb-1"
        style={{ fontFamily: "DMSans" }}
      >
        Unlock Pro
      </Text>
      <Text
        className="text-xs text-[#4b5563] dark:text-[#9ca3af] mb-3"
        style={{ fontFamily: "DMSans" }}
      >
        100 summaries/month, unlimited history, video chat, auto-tags, and more.
      </Text>
      <Pressable
        onPress={handleUpgrade}
        disabled={loading}
        className="px-4 py-2.5 border-2 border-black dark:border-[#505050] rounded-lg items-center"
        style={{ backgroundColor: neon[600], ...brutalShadowSm() }}
      >
        <Text className="text-white font-bold text-sm" style={{ fontFamily: "DMSans" }}>
          {loading ? "..." : "Upgrade to Pro"}
        </Text>
      </Pressable>
    </View>
  );
}
