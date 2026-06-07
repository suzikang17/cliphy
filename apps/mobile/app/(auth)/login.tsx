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
  useColorScheme,
} from "react-native";
import { Logo } from "../../components/Logo";
import { signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword } from "../../lib/auth";
import { checkEmail } from "../../lib/api";
import { brutalShadowSm } from "../../lib/theme";
import { colors, neon, isValidEmail, type EmailAuthStatus } from "@cliphy/shared";

type Step = "email" | "credentials";

function humanizeAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Incorrect password.";
  if (/already registered/i.test(message)) return "That email is already registered.";
  return message;
}

export default function LoginScreen() {
  const [step, setStep] = useState<Step>("email");
  const [status, setStatus] = useState<EmailAuthStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDark = useColorScheme() === "dark";
  const placeholderColor = isDark ? colors.dark.textMuted : colors.light.textMuted;

  const normalizedEmail = () => email.trim().toLowerCase();

  async function handleContinueEmail() {
    const e = normalizedEmail();
    if (!isValidEmail(e)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await checkEmail(e);
      setStatus(res.status);
      setStep("credentials");
    } catch {
      // Endpoint unavailable — degrade gracefully to a password attempt so
      // existing users are never blocked from logging in.
      setStatus("password");
      setStep("credentials");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitCredentials() {
    setError(null);
    if (status === "new") {
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match.");
        return;
      }
    } else if (!password) {
      setError("Enter your password.");
      return;
    }
    setLoading(true);
    try {
      if (status === "new") {
        await signUpWithEmail(normalizedEmail(), password);
      } else {
        await signInWithEmail(normalizedEmail(), password);
      }
      // Successful auth flips the session; _layout.tsx routes into (tabs).
    } catch (err: unknown) {
      setError(err instanceof Error ? humanizeAuthError(err.message) : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      if (err instanceof Error && err.message !== "OAuth cancelled") setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot() {
    try {
      await resetPassword(normalizedEmail());
      Alert.alert("Check your email", "We sent you a link to reset your password.");
    } catch (err: unknown) {
      Alert.alert("Error", err instanceof Error ? err.message : "Couldn't send reset email.");
    }
  }

  function editEmail() {
    setStep("email");
    setStatus(null);
    setPassword("");
    setConfirm("");
    setError(null);
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
            Cliphy
          </Text>
          <Text
            className="text-sm text-[#6b7280] dark:text-[#9ca3af] mt-1"
            style={{ fontFamily: "DMSans" }}
          >
            YouTube summaries, instantly
          </Text>
        </View>

        {step === "credentials" && (
          <Pressable onPress={editEmail} className="mb-3 flex-row items-center gap-1">
            <Text className="text-sm" style={{ color: neon[600], fontFamily: "DMSans" }}>
              ← {normalizedEmail()}
            </Text>
          </Pressable>
        )}

        {step === "email" && (
          <View className="gap-3 mb-4">
            <TextInput
              className={inputClass}
              style={{ fontFamily: "DMSans" }}
              placeholder="Email"
              placeholderTextColor={placeholderColor}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={handleContinueEmail}
              accessibilityLabel="Email address"
            />
          </View>
        )}

        {step === "credentials" && status !== "google" && (
          <View className="gap-3 mb-4">
            <TextInput
              className={inputClass}
              style={{ fontFamily: "DMSans" }}
              placeholder="Password"
              placeholderTextColor={placeholderColor}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoFocus
              autoComplete={status === "new" ? "new-password" : "current-password"}
              returnKeyType={status === "new" ? "next" : "go"}
              onSubmitEditing={status === "new" ? undefined : handleSubmitCredentials}
              accessibilityLabel="Password"
            />
            {status === "new" && (
              <TextInput
                className={inputClass}
                style={{ fontFamily: "DMSans" }}
                placeholder="Confirm password"
                placeholderTextColor={placeholderColor}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoComplete="new-password"
                returnKeyType="go"
                onSubmitEditing={handleSubmitCredentials}
                accessibilityLabel="Confirm password"
              />
            )}
          </View>
        )}

        {status === "google" && step === "credentials" && (
          <Text
            className="text-sm text-[#6b7280] dark:text-[#9ca3af] mb-4"
            style={{ fontFamily: "DMSans" }}
          >
            This account uses Google sign-in. Continue with Google below.
          </Text>
        )}

        {error && (
          <Text className="text-sm text-red-600 mb-3" style={{ fontFamily: "DMSans" }}>
            {error}
          </Text>
        )}

        {status !== "google" && (
          <Pressable
            onPress={step === "email" ? handleContinueEmail : handleSubmitCredentials}
            disabled={loading}
            className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg items-center mb-3"
            style={{ backgroundColor: neon[600], ...brutalShadowSm() }}
          >
            <Text className="text-white font-bold text-base" style={{ fontFamily: "DMSans" }}>
              {loading
                ? "Please wait…"
                : step === "email"
                  ? "Continue"
                  : status === "new"
                    ? "Create Account"
                    : "Log In"}
            </Text>
          </Pressable>
        )}

        {step === "credentials" && status === "password" && (
          <Pressable onPress={handleForgot} className="mb-3">
            <Text
              className="text-center text-sm"
              style={{ color: neon[600], fontFamily: "DMSans" }}
            >
              Forgot password?
            </Text>
          </Pressable>
        )}

        {(step === "email" || status === "google") && (
          <>
            <View className="flex-row items-center my-6">
              <View className="flex-1 h-px bg-[#e5e7eb] dark:bg-[#2a2a2a]" />
              <Text className="mx-3 text-xs text-[#6b7280]">or</Text>
              <View className="flex-1 h-px bg-[#e5e7eb] dark:bg-[#2a2a2a]" />
            </View>
            <Pressable
              onPress={handleGoogle}
              disabled={loading}
              className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-white dark:bg-[#333333] items-center flex-row justify-center gap-2"
              style={brutalShadowSm()}
            >
              <Text
                className="font-bold text-base text-[#111827] dark:text-white"
                style={{ fontFamily: "DMSans" }}
              >
                Continue with Google
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
