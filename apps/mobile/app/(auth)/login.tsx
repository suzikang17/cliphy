import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from "react-native";
import { Logo } from "../../components/Logo";
import { signInWithEmail, signUpWithEmail, signInWithGoogle } from "../../lib/auth";
import { brutalShadowSm } from "../../lib/theme";
import { colors, neon } from "@cliphy/shared";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email || !password) return;
    setLoading(true);
    try {
      if (mode === "signup") {
        await signUpWithEmail(email, password);
        Alert.alert("Check your email", "We sent you a confirmation link.");
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      if (err instanceof Error && err.message !== "OAuth cancelled") {
        Alert.alert("Error", err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-white dark:bg-[#1e1e1e]"
    >
      <ScrollView
        contentContainerClassName="flex-1 justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo + Tagline */}
        <View className="items-center mb-10">
          <Logo size={64} />
          <Text
            className="text-2xl font-bold mt-3 text-[#111827] dark:text-white"
            style={{ fontFamily: "DMSans" }}
          >
            Cliphy
          </Text>
          <Text className="text-sm text-[#6b7280] mt-1" style={{ fontFamily: "DMSans" }}>
            YouTube summaries, instantly
          </Text>
        </View>

        {/* Email/Password Form */}
        <View className="gap-3 mb-4">
          <TextInput
            className="px-4 py-3 text-sm border-2 border-black dark:border-[#505050] rounded-lg bg-[#f3f4f6] dark:bg-[#333333] text-[#111827] dark:text-white"
            style={{ fontFamily: "DMSans" }}
            placeholder="Email"
            placeholderTextColor={colors.light.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextInput
            className="px-4 py-3 text-sm border-2 border-black dark:border-[#505050] rounded-lg bg-[#f3f4f6] dark:bg-[#333333] text-[#111827] dark:text-white"
            style={{ fontFamily: "DMSans" }}
            placeholder="Password"
            placeholderTextColor={colors.light.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </View>

        {/* Submit Button */}
        <Pressable
          onPress={handleSubmit}
          disabled={loading || !email || !password}
          className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg items-center mb-3"
          style={{
            backgroundColor: neon[600],
            ...brutalShadowSm(),
          }}
        >
          <Text className="text-white font-bold text-sm" style={{ fontFamily: "DMSans" }}>
            {loading ? "..." : mode === "signup" ? "Sign Up" : "Sign In"}
          </Text>
        </Pressable>

        {/* Toggle mode */}
        <Pressable onPress={() => setMode(mode === "signin" ? "signup" : "signin")}>
          <Text className="text-center text-sm text-[#6b7280]" style={{ fontFamily: "DMSans" }}>
            {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
            <Text className="font-bold" style={{ color: neon[600] }}>
              {mode === "signin" ? "Sign up" : "Sign in"}
            </Text>
          </Text>
        </Pressable>

        {/* Divider */}
        <View className="flex-row items-center my-6">
          <View className="flex-1 h-px bg-[#e5e7eb] dark:bg-[#2a2a2a]" />
          <Text className="mx-3 text-xs text-[#6b7280]">or</Text>
          <View className="flex-1 h-px bg-[#e5e7eb] dark:bg-[#2a2a2a]" />
        </View>

        {/* Google Button */}
        <Pressable
          onPress={handleGoogle}
          disabled={loading}
          className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-white dark:bg-[#333333] items-center flex-row justify-center gap-2"
          style={brutalShadowSm()}
        >
          <Text
            className="font-bold text-sm text-[#111827] dark:text-white"
            style={{ fontFamily: "DMSans" }}
          >
            Continue with Google
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
