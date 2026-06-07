import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  useColorScheme,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Logo } from "../../components/Logo";
import { exchangeRecoveryCode, updatePassword } from "../../lib/auth";
import { brutalShadowSm } from "../../lib/theme";
import { colors, neon } from "@cliphy/shared";

export default function ResetScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const isDark = useColorScheme() === "dark";
  const placeholderColor = isDark ? colors.dark.textMuted : colors.light.textMuted;

  const [exchanging, setExchanging] = useState(true);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!code) {
        setError("This reset link is invalid or has expired.");
        setExchanging(false);
        return;
      }
      try {
        await exchangeRecoveryCode(code);
        setReady(true);
      } catch {
        setError("This reset link is invalid or has expired.");
      } finally {
        setExchanging(false);
      }
    })();
  }, [code]);

  async function handleSave() {
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      // Recovery session is now a full session — go into the app.
      router.replace("/(tabs)");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't update password.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "px-4 py-3.5 text-base border-2 border-black dark:border-[#505050] rounded-lg bg-[#f3f4f6] dark:bg-[#333333] text-[#111827] dark:text-white";

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-white dark:bg-[#1e1e1e]"
    >
      <ScrollView
        contentContainerClassName="flex-1 justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center mb-10">
          <Logo size={64} />
          <Text
            className="text-2xl font-bold mt-3 text-[#111827] dark:text-white"
            style={{ fontFamily: "DMSans" }}
          >
            Set a new password
          </Text>
        </View>

        {exchanging ? (
          <ActivityIndicator color={neon[600]} />
        ) : ready ? (
          <>
            <View className="gap-3 mb-4">
              <TextInput
                className={inputClass}
                style={{ fontFamily: "DMSans" }}
                placeholder="New password"
                placeholderTextColor={placeholderColor}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
                accessibilityLabel="New password"
              />
              <TextInput
                className={inputClass}
                style={{ fontFamily: "DMSans" }}
                placeholder="Confirm new password"
                placeholderTextColor={placeholderColor}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoComplete="new-password"
                returnKeyType="go"
                onSubmitEditing={handleSave}
                accessibilityLabel="Confirm new password"
              />
            </View>
            {error && (
              <Text className="text-sm text-red-600 mb-3" style={{ fontFamily: "DMSans" }}>
                {error}
              </Text>
            )}
            <Pressable
              onPress={handleSave}
              disabled={loading}
              className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg items-center"
              style={{ backgroundColor: neon[600], ...brutalShadowSm() }}
            >
              <Text className="text-white font-bold text-base" style={{ fontFamily: "DMSans" }}>
                {loading ? "Saving…" : "Save password"}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text className="text-sm text-red-600 mb-4" style={{ fontFamily: "DMSans" }}>
              {error}
            </Text>
            <Pressable onPress={() => router.replace("/(auth)/login")}>
              <Text
                className="text-center text-sm"
                style={{ color: neon[600], fontFamily: "DMSans" }}
              >
                Back to login
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
