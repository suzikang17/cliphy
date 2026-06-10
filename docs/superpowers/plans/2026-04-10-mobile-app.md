---
title: "Cliphy Mobile App Implementation Plan"
date: 2026-04-10
---

# Cliphy Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an iOS (and later Android) mobile app that lets users add YouTube videos to their Cliphy queue via share sheet, get push notifications when summaries are ready, and read summaries on the go — matching the extension's neobrutalist design system.

**Architecture:** Expo (managed workflow) React Native app living in `apps/mobile/`. Shares types from `@cliphy/shared`. Uses the existing Hono API as-is — the app is a new client, no backend changes needed (except a push token registration endpoint). NativeWind for Tailwind-compatible styling. Supabase Auth for login, Supabase Realtime for live queue updates, Expo Notifications + FCM/APNs for push.

**Tech Stack:** Expo SDK 53, React Native, NativeWind v4 (Tailwind for RN), expo-share-intent, expo-notifications, expo-secure-store, @supabase/supabase-js, expo-router (file-based navigation)

---

## File Structure

```
apps/mobile/
├── app/                          # expo-router file-based routes
│   ├── _layout.tsx               # Root layout (auth gate, providers, fonts)
│   ├── (auth)/                   # Unauthenticated routes
│   │   ├── _layout.tsx
│   │   └── login.tsx             # Login/signup screen
│   ├── (tabs)/                   # Authenticated tab navigator
│   │   ├── _layout.tsx           # Tab bar config
│   │   ├── index.tsx             # Queue screen (home tab)
│   │   └── settings.tsx          # Settings/account screen
│   └── summary/
│       └── [id].tsx              # Summary detail screen
├── components/
│   ├── QueueCard.tsx             # Single queue item card
│   ├── SummaryContent.tsx        # Summary body (TL;DR, key points, timestamps)
│   ├── UsageBar.tsx              # Usage progress + upgrade
│   ├── Logo.tsx                  # Cliphy logo SVG
│   ├── ProBadge.tsx              # "Pro" indicator
│   ├── UpgradePrompt.tsx         # Upgrade CTA card
│   ├── EmptyState.tsx            # No items placeholder
│   └── Skeleton.tsx              # Loading shimmer
├── lib/
│   ├── api.ts                    # API client (port from extension)
│   ├── auth.ts                   # Supabase auth helpers
│   ├── supabase.ts               # Supabase client init
│   ├── notifications.ts          # Push notification setup + token registration
│   ├── clipboard.ts              # YouTube URL clipboard detection
│   ├── storage.ts                # expo-secure-store token helpers
│   └── theme.ts                  # Design tokens (colors, shadows, fonts)
├── assets/
│   └── fonts/
│       └── DMSans-Variable.ttf   # DM Sans variable font
├── app.json                      # Expo config (share extension, notifications, etc.)
├── tailwind.config.ts            # NativeWind theme matching extension tokens
├── global.css                    # Tailwind base + custom tokens
├── metro.config.js               # Metro bundler config for monorepo
├── tsconfig.json
├── babel.config.js
├── package.json
└── eas.json                      # EAS Build config for App Store submission
```

---

## Design Token Mapping

The extension's CSS variables map to the mobile theme like this:

| Extension Token             | Light            | Dark                               | Usage                     |
| --------------------------- | ---------------- | ---------------------------------- | ------------------------- |
| `--color-surface`           | `#ffffff`        | `#1e1e1e`                          | Screen backgrounds        |
| `--color-surface-secondary` | `#f8f8f8`        | `#252525`                          | Card backgrounds          |
| `--color-surface-raised`    | `#f5f5f5`        | `#2e2e2e`                          | Inputs, elevated surfaces |
| `--color-border-hard`       | `#000000`        | `#505050`                          | Card borders, buttons     |
| `--color-border-soft`       | `#e5e5e5`        | `#3a3a3a`                          | Dividers                  |
| `--color-text`              | `#111827`        | `#ffffff`                          | Headings                  |
| `--color-text-body`         | `#1f2937`        | `#e5e7eb`                          | Body text                 |
| `--color-text-secondary`    | `#4b5563`        | `#9ca3af`                          | Labels                    |
| `--color-text-muted`        | `#6b7280`        | `#6b7280`                          | Timestamps                |
| `--color-neon-600`          | `#9358c7`        | `#9358c7`                          | Primary accent, CTAs      |
| Shadow (brutal)             | `4px 4px 0 #000` | `4px 4px 0 rgba(255,255,255,0.12)` | Cards, buttons            |

**Font:** DM Sans Variable (same as extension, bundled via expo-font)

**Border pattern:** 2px solid, `rounded-lg` (8px radius), brutal offset shadow

---

### Task 1: Scaffold Expo App in Monorepo

**Files:**

- Create: `apps/mobile/package.json`
- Create: `apps/mobile/app.json`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/babel.config.js`
- Create: `apps/mobile/metro.config.js`
- Create: `apps/mobile/eas.json`
- Modify: `pnpm-workspace.yaml` (add `apps/mobile`)
- Modify: `package.json` (add `dev:mobile` script)

- [ ] **Step 1: Create the Expo app**

```bash
cd apps && npx create-expo-app@latest mobile --template blank-typescript && cd ..
```

- [ ] **Step 2: Add mobile to pnpm workspace**

In `pnpm-workspace.yaml`, ensure `apps/mobile` is included (it should be via `apps/*` glob — verify).

- [ ] **Step 3: Add root dev script**

In root `package.json`, add:

```json
"dev:mobile": "pnpm --filter mobile start"
```

- [ ] **Step 4: Configure monorepo Metro resolution**

Create `apps/mobile/metro.config.js`:

```javascript
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
```

- [ ] **Step 5: Add `@cliphy/shared` as dependency**

```bash
cd apps/mobile && pnpm add @cliphy/shared@workspace:*
```

- [ ] **Step 6: Install and run to verify scaffold works**

```bash
pnpm install && pnpm dev:mobile
```

Expected: Expo dev server starts, default blank screen renders in Expo Go.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "scaffold Expo app in monorepo"
```

---

### Task 2: Set Up NativeWind + Design Tokens

**Files:**

- Create: `apps/mobile/global.css`
- Create: `apps/mobile/tailwind.config.ts`
- Create: `apps/mobile/lib/theme.ts`
- Create: `apps/mobile/nativewind-env.d.ts`
- Modify: `apps/mobile/metro.config.js`
- Modify: `apps/mobile/babel.config.js`
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Install NativeWind and dependencies**

```bash
cd apps/mobile && pnpm add nativewind && pnpm add -D tailwindcss@^3.4 postcss
```

Note: NativeWind v4 uses Tailwind v3 under the hood, not v4.

- [ ] **Step 2: Create tailwind.config.ts with Cliphy design tokens**

```typescript
import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DMSans"],
        "sans-bold": ["DMSans_700Bold"],
      },
      colors: {
        surface: {
          DEFAULT: "var(--color-surface)",
          secondary: "var(--color-surface-secondary)",
          raised: "var(--color-surface-raised)",
        },
        border: {
          hard: "var(--color-border-hard)",
          soft: "var(--color-border-soft)",
          muted: "var(--color-border-muted)",
        },
        text: {
          DEFAULT: "var(--color-text)",
          body: "var(--color-text-body)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
        },
        neon: {
          100: "#f3e8ff",
          200: "#e2c6ff",
          300: "#c79bf5",
          400: "#b07ce8",
          500: "#a46ddb",
          600: "#9358c7",
          700: "#7c3aad",
          800: "#5b2383",
          900: "#3b1359",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3: Create global.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Create theme.ts with runtime design tokens**

This provides the shadow/color values for components that need runtime styles (RN shadows can't be done purely in Tailwind):

```typescript
import { Appearance } from "react-native";

const light = {
  surface: "#ffffff",
  surfaceSecondary: "#f8f8f8",
  surfaceRaised: "#f5f5f5",
  borderHard: "#000000",
  borderSoft: "#e5e5e5",
  text: "#111827",
  textBody: "#1f2937",
  textSecondary: "#4b5563",
  textMuted: "#6b7280",
  neon600: "#9358c7",
  shadowColor: "#000000",
};

const dark: typeof light = {
  surface: "#1e1e1e",
  surfaceSecondary: "#252525",
  surfaceRaised: "#2e2e2e",
  borderHard: "#505050",
  borderSoft: "#3a3a3a",
  text: "#ffffff",
  textBody: "#e5e7eb",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  neon600: "#9358c7",
  shadowColor: "rgba(255,255,255,0.12)",
};

export function getTheme() {
  return Appearance.getColorScheme() === "dark" ? dark : light;
}

export const brutalShadow = (color: string) => ({
  shadowColor: color,
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 4,
});

export const brutalShadowSm = (color: string) => ({
  shadowColor: color,
  shadowOffset: { width: 3, height: 3 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 3,
});
```

- [ ] **Step 5: Update babel.config.js for NativeWind**

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
```

- [ ] **Step 6: Update metro.config.js for NativeWind CSS**

Add to the existing metro config:

```javascript
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = withNativeWind(config, { input: "./global.css" });
```

- [ ] **Step 7: Create nativewind-env.d.ts**

```typescript
/// <reference types="nativewind/types" />
```

- [ ] **Step 8: Verify NativeWind works**

Replace `apps/mobile/app/index.tsx` with:

```tsx
import "../global.css";
import { View, Text } from "react-native";

export default function App() {
  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-[#1e1e1e]">
      <Text className="text-2xl font-bold text-[#9358c7]">Cliphy</Text>
    </View>
  );
}
```

Run `pnpm dev:mobile`, verify purple "Cliphy" text renders on correct background.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile
git commit -m "add NativeWind with Cliphy design tokens"
```

---

### Task 3: Load DM Sans Font

**Files:**

- Create: `apps/mobile/assets/fonts/` (directory)
- Modify: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Install expo-font and DM Sans**

```bash
cd apps/mobile && pnpm add expo-font @fontsource-variable/dm-sans
```

- [ ] **Step 2: Copy the font file**

The variable font TTF needs to be in the assets directory. Grab it from the npm package:

```bash
cp node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2 assets/fonts/DMSans-Variable.ttf
```

Note: If woff2 doesn't work with expo-font, download the TTF from Google Fonts instead:

```bash
curl -L "https://fonts.google.com/download?family=DM+Sans" -o /tmp/dm-sans.zip && unzip -o /tmp/dm-sans.zip -d /tmp/dm-sans && cp /tmp/dm-sans/DM_Sans/DM_Sans-VariableFont_opsz,wght.ttf assets/fonts/DMSans-Variable.ttf
```

- [ ] **Step 3: Create root layout with font loading**

Create `apps/mobile/app/_layout.tsx`:

```tsx
import "../global.css";
import { useEffect } from "react";
import { Slot } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans: require("../assets/fonts/DMSans-Variable.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return <Slot />;
}
```

- [ ] **Step 4: Verify font renders**

Run the app, confirm "Cliphy" text uses DM Sans (visually compare with extension).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "load DM Sans font"
```

---

### Task 4: Auth — Supabase Client + Secure Token Storage

**Files:**

- Create: `apps/mobile/lib/storage.ts`
- Create: `apps/mobile/lib/supabase.ts`
- Create: `apps/mobile/lib/auth.ts`

- [ ] **Step 1: Install dependencies**

```bash
cd apps/mobile && pnpm add @supabase/supabase-js expo-secure-store
```

- [ ] **Step 2: Create secure storage adapter**

`apps/mobile/lib/storage.ts`:

```typescript
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "cliphy_supabase_session";

export async function getStoredSession(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function storeSession(session: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, session);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
```

- [ ] **Step 3: Create Supabase client with secure storage**

`apps/mobile/lib/supabase.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

- [ ] **Step 4: Create auth helpers**

`apps/mobile/lib/auth.ts`:

```typescript
import { supabase } from "./supabase";

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  // Uses Supabase OAuth with expo-auth-session — implemented in Task 5
  throw new Error("Not implemented yet");
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "add Supabase auth with secure token storage"
```

---

### Task 5: Auth — Google OAuth for Mobile

**Files:**

- Modify: `apps/mobile/lib/auth.ts`
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Install expo-auth-session**

```bash
cd apps/mobile && pnpm add expo-auth-session expo-crypto expo-web-browser
```

- [ ] **Step 2: Implement Google OAuth**

Update `signInWithGoogle` in `apps/mobile/lib/auth.ts`:

```typescript
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

const redirectUri = AuthSession.makeRedirectUri({
  scheme: "com.cliphy.app",
  path: "auth/callback",
});

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUri,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

  if (result.type !== "success") {
    throw new Error("OAuth cancelled");
  }

  // Extract tokens from callback URL
  const url = new URL(result.url);
  const params = new URLSearchParams(url.hash.substring(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) {
    throw new Error("Missing tokens in OAuth callback");
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (sessionError) throw sessionError;

  return sessionData;
}
```

- [ ] **Step 3: Configure app scheme for deep linking**

In `apps/mobile/app.json`, add:

```json
{
  "expo": {
    "scheme": "com.cliphy.app"
  }
}
```

- [ ] **Step 4: Add redirect URI to Supabase**

In Supabase Dashboard → Authentication → URL Configuration → Redirect URLs, add:

```
com.cliphy.app://auth/callback
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "add Google OAuth for mobile"
```

---

### Task 6: Auth — Login Screen UI

**Files:**

- Create: `apps/mobile/app/(auth)/_layout.tsx`
- Create: `apps/mobile/app/(auth)/login.tsx`
- Create: `apps/mobile/components/Logo.tsx`

- [ ] **Step 1: Create Logo component**

Port the SVG logo from the extension. `apps/mobile/components/Logo.tsx`:

```tsx
import Svg, { Path, Circle, G } from "react-native-svg";

// Copy the exact SVG paths from apps/extension/components/Logo.tsx
// Use react-native-svg equivalents
export function Logo({ size = 48 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Port SVG paths from extension Logo.tsx */}
    </Svg>
  );
}
```

Install: `cd apps/mobile && pnpm add react-native-svg`

- [ ] **Step 2: Create auth layout**

`apps/mobile/app/(auth)/_layout.tsx`:

```tsx
import { Stack } from "expo-router";

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 3: Create login screen**

`apps/mobile/app/(auth)/login.tsx`:

```tsx
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
import { brutalShadowSm, getTheme } from "../../lib/theme";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const theme = getTheme();

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
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err.message !== "OAuth cancelled") {
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
            className="px-4 py-3 text-sm border-2 border-black dark:border-[#505050] rounded-lg bg-[#f5f5f5] dark:bg-[#2e2e2e] text-[#111827] dark:text-white"
            style={{ fontFamily: "DMSans" }}
            placeholder="Email"
            placeholderTextColor="#6b7280"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextInput
            className="px-4 py-3 text-sm border-2 border-black dark:border-[#505050] rounded-lg bg-[#f5f5f5] dark:bg-[#2e2e2e] text-[#111827] dark:text-white"
            style={{ fontFamily: "DMSans" }}
            placeholder="Password"
            placeholderTextColor="#6b7280"
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
          className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-[#9358c7] items-center mb-3"
          style={brutalShadowSm(theme.shadowColor)}
        >
          <Text className="text-white font-bold text-sm" style={{ fontFamily: "DMSans" }}>
            {loading ? "..." : mode === "signup" ? "Sign Up" : "Sign In"}
          </Text>
        </Pressable>

        {/* Toggle mode */}
        <Pressable onPress={() => setMode(mode === "signin" ? "signup" : "signin")}>
          <Text className="text-center text-sm text-[#6b7280]" style={{ fontFamily: "DMSans" }}>
            {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
            <Text className="text-[#9358c7] font-bold">
              {mode === "signin" ? "Sign up" : "Sign in"}
            </Text>
          </Text>
        </Pressable>

        {/* Divider */}
        <View className="flex-row items-center my-6">
          <View className="flex-1 h-px bg-[#e5e5e5] dark:bg-[#3a3a3a]" />
          <Text className="mx-3 text-xs text-[#6b7280]">or</Text>
          <View className="flex-1 h-px bg-[#e5e5e5] dark:bg-[#3a3a3a]" />
        </View>

        {/* Google Button */}
        <Pressable
          onPress={handleGoogle}
          disabled={loading}
          className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-white dark:bg-[#2e2e2e] items-center flex-row justify-center gap-2"
          style={brutalShadowSm(theme.shadowColor)}
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
```

- [ ] **Step 4: Verify login screen renders**

Run app, confirm neobrutalist login screen shows with correct fonts, colors, brutal shadows, and border style. Compare visually with extension login.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "add login screen with neobrutalist styling"
```

---

### Task 7: Auth Gate + Navigation Shell

**Files:**

- Modify: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/index.tsx`
- Create: `apps/mobile/app/(tabs)/settings.tsx`

- [ ] **Step 1: Update root layout with auth gate**

`apps/mobile/app/_layout.tsx`:

```tsx
import "../global.css";
import { useEffect, useState } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  const [fontsLoaded] = useFonts({
    DMSans: require("../assets/fonts/DMSans-Variable.ttf"),
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitialized(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!initialized || !fontsLoaded) return;

    const inAuth = segments[0] === "(auth)";

    if (!session && !inAuth) {
      router.replace("/(auth)/login");
    } else if (session && inAuth) {
      router.replace("/(tabs)");
    }
  }, [session, initialized, fontsLoaded, segments]);

  useEffect(() => {
    if (fontsLoaded && initialized) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, initialized]);

  if (!fontsLoaded || !initialized) return null;

  return <Slot />;
}
```

- [ ] **Step 2: Create tab layout**

`apps/mobile/app/(tabs)/_layout.tsx`:

```tsx
import { Tabs } from "expo-router";
import { getTheme } from "../../lib/theme";

export default function TabLayout() {
  const theme = getTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.neon600,
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
          tabBarIcon: ({ color }) => ({
            /* Simple queue icon — use emoji for now, replace with SVG later */
          }),
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
```

- [ ] **Step 3: Create placeholder queue screen**

`apps/mobile/app/(tabs)/index.tsx`:

```tsx
import { View, Text } from "react-native";

export default function QueueScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-[#1e1e1e]">
      <Text
        className="text-lg font-bold text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
      >
        Queue
      </Text>
      <Text className="text-sm text-[#6b7280] mt-1" style={{ fontFamily: "DMSans" }}>
        Your videos will show up here
      </Text>
    </View>
  );
}
```

- [ ] **Step 4: Create placeholder settings screen**

`apps/mobile/app/(tabs)/settings.tsx`:

```tsx
import { View, Text, Pressable, Alert } from "react-native";
import { signOut } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { useEffect, useState } from "react";
import { brutalShadowSm, getTheme } from "../../lib/theme";

export default function SettingsScreen() {
  const [email, setEmail] = useState("");
  const theme = getTheme();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? "");
    });
  }, []);

  async function handleSignOut() {
    try {
      await signOut();
    } catch (err: any) {
      Alert.alert("Error", err.message);
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
        className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#f8f8f8] dark:bg-[#252525] mb-6"
        style={brutalShadowSm(theme.shadowColor)}
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
        style={brutalShadowSm(theme.shadowColor)}
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
```

- [ ] **Step 5: Test auth flow end-to-end**

1. Open app → should redirect to login screen
2. Sign in with email/password → should redirect to Queue tab
3. Go to Settings → should show email
4. Sign out → should redirect back to login

- [ ] **Step 6: Commit**

```bash
git add apps/mobile
git commit -m "add auth gate and tab navigation shell"
```

---

### Task 8: API Client

**Files:**

- Create: `apps/mobile/lib/api.ts`

- [ ] **Step 1: Port the API client from the extension**

`apps/mobile/lib/api.ts` — adapted from `apps/extension/lib/api.ts`:

```typescript
import { getAccessToken } from "./auth";
import { supabase } from "./supabase";
import type { Summary, SummaryJson, UsageInfo } from "@cliphy/shared";

const API_URL = process.env.EXPO_PUBLIC_API_URL!;

// Error classes (same as extension)
export class AuthError extends Error {
  constructor(message = "Session expired") {
    super(message);
    this.name = "AuthError";
  }
}

export class RateLimitError extends Error {
  limit: number;
  plan: string;
  constructor(limit: number, plan: string) {
    super(`Monthly limit reached (${limit})`);
    this.name = "RateLimitError";
    this.limit = limit;
    this.plan = plan;
  }
}

export class ProRequiredError extends Error {
  feature: string;
  constructor(feature: string) {
    super(`Pro required: ${feature}`);
    this.name = "ProRequiredError";
    this.feature = feature;
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let token = await getAccessToken();

  if (!token) {
    // Try refreshing the session
    const { data } = await supabase.auth.refreshSession();
    token = data.session?.access_token ?? null;
    if (!token) throw new AuthError();
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    // Try refresh once
    const { data } = await supabase.auth.refreshSession();
    const newToken = data.session?.access_token;
    if (!newToken) throw new AuthError();

    const retry = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${newToken}`,
        ...options.headers,
      },
    });
    if (retry.status === 401) throw new AuthError();
    return retry.json();
  }

  if (res.status === 429) {
    const body = await res.json();
    throw new RateLimitError(body.limit, body.plan);
  }

  if (res.status === 402) {
    const body = await res.json();
    throw new ProRequiredError(body.feature);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json();
}

// Queue
export const getQueue = () => apiFetch<{ items: Summary[] }>("/api/queue");

export const addToQueue = (body: { videoUrl: string; videoTitle?: string }) =>
  apiFetch<{ summary: Summary; position: number }>("/api/queue", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const deleteQueueItem = (id: string) =>
  apiFetch<{ deleted: true }>(`/api/queue/${id}`, { method: "DELETE" });

export const retryQueueItem = (id: string) =>
  apiFetch<{ summary: Summary }>(`/api/queue/${id}/retry`, { method: "POST" });

// Summaries
export const getSummaries = (params?: { tag?: string; limit?: number; offset?: number }) => {
  const qs = new URLSearchParams();
  if (params?.tag) qs.set("tag", params.tag);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const query = qs.toString();
  return apiFetch<{ summaries: Summary[]; total: number }>(
    `/api/summaries${query ? `?${query}` : ""}`,
  );
};

export const getSummary = (id: string) => apiFetch<{ summary: Summary }>(`/api/summaries/${id}`);

export const deleteSummary = (id: string) =>
  apiFetch<{ deleted: true }>(`/api/summaries/${id}`, { method: "DELETE" });

// Usage
export const getUsage = () => apiFetch<{ usage: UsageInfo }>("/api/usage");

// Billing
export const createCheckout = () =>
  apiFetch<{ url: string }>("/api/billing/checkout", { method: "POST" });

export const createPortal = () =>
  apiFetch<{ url: string }>("/api/billing/portal", { method: "POST" });
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/lib/api.ts
git commit -m "port API client for mobile"
```

---

### Task 9: Queue Screen — List + Pull-to-Refresh

**Files:**

- Create: `apps/mobile/components/QueueCard.tsx`
- Create: `apps/mobile/components/Skeleton.tsx`
- Create: `apps/mobile/components/EmptyState.tsx`
- Create: `apps/mobile/components/UsageBar.tsx`
- Modify: `apps/mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Create Skeleton component**

`apps/mobile/components/Skeleton.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

export function Skeleton({ className = "" }: { className?: string }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      className={`bg-[#e5e5e5] dark:bg-[#3a3a3a] rounded ${className}`}
      style={{ opacity }}
    />
  );
}

export function QueueCardSkeleton() {
  return (
    <View className="border-2 border-black dark:border-[#505050] rounded-lg p-3 gap-2 bg-[#f8f8f8] dark:bg-[#252525]">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-1/4" />
    </View>
  );
}
```

- [ ] **Step 2: Create EmptyState component**

`apps/mobile/components/EmptyState.tsx`:

```tsx
import { View, Text } from "react-native";

export function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center py-20 px-6">
      <Text className="text-4xl mb-3">🎬</Text>
      <Text
        className="text-lg font-bold text-[#111827] dark:text-white text-center"
        style={{ fontFamily: "DMSans" }}
      >
        No videos yet
      </Text>
      <Text className="text-sm text-[#6b7280] text-center mt-1" style={{ fontFamily: "DMSans" }}>
        Share a YouTube video to get started
      </Text>
    </View>
  );
}
```

- [ ] **Step 3: Create QueueCard component**

`apps/mobile/components/QueueCard.tsx`:

```tsx
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import type { Summary } from "@cliphy/shared";
import { brutalShadowSm, getTheme } from "../lib/theme";

const STATUS_LABELS: Record<string, { label: string; color: string; darkColor: string }> = {
  pending: { label: "Queued", color: "#6b7280", darkColor: "#9ca3af" },
  processing: { label: "Summarizing...", color: "#9358c7", darkColor: "#9358c7" },
  completed: { label: "Done", color: "#16a34a", darkColor: "#4ade80" },
  failed: { label: "Failed", color: "#dc2626", darkColor: "#f87171" },
};

export function QueueCard({ item }: { item: Summary }) {
  const router = useRouter();
  const theme = getTheme();
  const status = STATUS_LABELS[item.status] ?? STATUS_LABELS.pending;

  return (
    <Pressable
      onPress={() => {
        if (item.status === "completed") {
          router.push(`/summary/${item.id}`);
        }
      }}
      className="border-2 border-black dark:border-[#505050] rounded-lg p-3 bg-[#f8f8f8] dark:bg-[#252525]"
      style={brutalShadowSm(theme.shadowColor)}
    >
      <Text
        className="text-sm font-bold text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
        numberOfLines={2}
      >
        {item.videoTitle || `Video ${item.videoId}`}
      </Text>

      {item.videoChannel && (
        <Text className="text-xs text-[#6b7280] mt-0.5" style={{ fontFamily: "DMSans" }}>
          {item.videoChannel}
        </Text>
      )}

      <View className="flex-row items-center justify-between mt-2">
        <View className="flex-row items-center gap-1">
          <View
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: theme.surface === "#ffffff" ? status.color : status.darkColor,
            }}
          />
          <Text
            className="text-xs font-medium"
            style={{
              fontFamily: "DMSans",
              color: theme.surface === "#ffffff" ? status.color : status.darkColor,
            }}
          >
            {status.label}
          </Text>
        </View>

        {item.tags?.length > 0 && (
          <View className="flex-row gap-1">
            {item.tags.slice(0, 2).map((tag) => (
              <View key={tag} className="bg-[#f3e8ff] dark:bg-[#3b1359] px-2 py-0.5 rounded">
                <Text className="text-[10px] text-[#9358c7]" style={{ fontFamily: "DMSans" }}>
                  {tag}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}
```

- [ ] **Step 4: Create UsageBar component**

`apps/mobile/components/UsageBar.tsx`:

```tsx
import { View, Text } from "react-native";
import type { UsageInfo } from "@cliphy/shared";
import { getTheme } from "../lib/theme";

export function UsageBar({ usage }: { usage: UsageInfo | null }) {
  if (!usage) return null;
  const theme = getTheme();
  const pct = Math.min((usage.used / usage.limit) * 100, 100);

  return (
    <View className="px-4 py-3 border-t border-[#e5e5e5] dark:border-[#3a3a3a] bg-white dark:bg-[#1e1e1e]">
      <View className="flex-row justify-between mb-1.5">
        <Text className="text-xs text-[#6b7280]" style={{ fontFamily: "DMSans" }}>
          {usage.used}/{usage.limit} summaries
        </Text>
        <Text className="text-xs font-bold text-[#9358c7]" style={{ fontFamily: "DMSans" }}>
          {usage.plan}
        </Text>
      </View>
      <View className="h-2 rounded-full bg-[#e5e5e5] dark:bg-[#3a3a3a]">
        <View className="h-2 rounded-full bg-[#9358c7]" style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}
```

- [ ] **Step 5: Wire up the Queue screen**

Replace `apps/mobile/app/(tabs)/index.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, RefreshControl, SafeAreaView } from "react-native";
import type { Summary, UsageInfo } from "@cliphy/shared";
import { getQueue, getUsage } from "../../lib/api";
import { QueueCard } from "../../components/QueueCard";
import { QueueCardSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { UsageBar } from "../../components/UsageBar";
import { Logo } from "../../components/Logo";

export default function QueueScreen() {
  const [items, setItems] = useState<Summary[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [queueRes, usageRes] = await Promise.all([getQueue(), getUsage()]);
      setItems(queueRes.items);
      setUsage(usageRes.usage);
    } catch (err) {
      console.error("Failed to fetch queue:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-[#1e1e1e]">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-[#e5e5e5] dark:border-[#3a3a3a]">
        <Logo size={28} />
        <Text
          className="text-lg font-bold ml-2 text-[#111827] dark:text-white"
          style={{ fontFamily: "DMSans" }}
        >
          Cliphy
        </Text>
      </View>

      {loading ? (
        <View className="px-4 py-4 gap-3">
          <QueueCardSkeleton />
          <QueueCardSkeleton />
          <QueueCardSkeleton />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <QueueCard item={item} />}
          contentContainerClassName="px-4 py-4 gap-3"
          ListEmptyComponent={<EmptyState />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#9358c7" />
          }
        />
      )}

      <UsageBar usage={usage} />
    </SafeAreaView>
  );
}
```

- [ ] **Step 6: Test queue screen**

Run app, sign in, verify:

- Loading skeletons appear
- Queue items render with correct styling (brutal borders, shadows)
- Pull-to-refresh works
- Usage bar shows at bottom
- Empty state shows when no items
- Tapping a completed item navigates (even though detail screen is placeholder)

- [ ] **Step 7: Commit**

```bash
git add apps/mobile
git commit -m "add queue screen with pull-to-refresh"
```

---

### Task 10: Summary Detail Screen

**Files:**

- Create: `apps/mobile/components/SummaryContent.tsx`
- Create: `apps/mobile/app/summary/[id].tsx`

- [ ] **Step 1: Create SummaryContent component**

`apps/mobile/components/SummaryContent.tsx`:

```tsx
import { View, Text, Pressable, Linking, ScrollView } from "react-native";
import type { Summary } from "@cliphy/shared";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-5">
      <Text
        className="text-xs font-bold text-[#6b7280] uppercase tracking-wide mb-2"
        style={{ fontFamily: "DMSans" }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

export function SummaryContent({ summary }: { summary: Summary }) {
  const json = summary.summaryJson;
  if (!json) return null;

  return (
    <View className="gap-1">
      {/* TL;DR */}
      <Section title="Summary">
        <Text
          className="text-sm text-[#1f2937] dark:text-[#e5e7eb] leading-5"
          style={{ fontFamily: "DMSans" }}
        >
          {json.summary}
        </Text>
      </Section>

      {/* Key Points */}
      {json.keyPoints?.length > 0 && (
        <Section title="Highlights">
          <View className="gap-2">
            {json.keyPoints.map((point, i) => (
              <View key={i} className="flex-row gap-2">
                <Text className="text-sm text-[#9358c7] font-bold" style={{ fontFamily: "DMSans" }}>
                  {"\u2022"}
                </Text>
                <Text
                  className="text-sm text-[#1f2937] dark:text-[#e5e7eb] leading-5 flex-1"
                  style={{ fontFamily: "DMSans" }}
                >
                  {point}
                </Text>
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* Context Section (adaptive) */}
      {json.contextSection && (
        <Section title={`${json.contextSection.icon} ${json.contextSection.title}`}>
          <View className="gap-1.5">
            {json.contextSection.items?.map((item, i) => (
              <Text
                key={i}
                className="text-sm text-[#1f2937] dark:text-[#e5e7eb]"
                style={{ fontFamily: "DMSans" }}
              >
                {item}
              </Text>
            ))}
          </View>
        </Section>
      )}

      {/* Timestamps */}
      {json.timestamps?.length > 0 && (
        <Section title="Timestamps">
          <View className="gap-1.5">
            {json.timestamps.map((ts, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  // Timestamps are formatted like "0:00 - Introduction"
                  // Extract time, convert to seconds, open YouTube at that time
                  const match = ts.match(/^(\d+):(\d+)/);
                  if (match && summary.videoUrl) {
                    const seconds = parseInt(match[1]) * 60 + parseInt(match[2]);
                    Linking.openURL(`${summary.videoUrl}&t=${seconds}`);
                  }
                }}
              >
                <Text className="text-sm text-[#9358c7]" style={{ fontFamily: "DMSans" }}>
                  {ts}
                </Text>
              </Pressable>
            ))}
          </View>
        </Section>
      )}

      {/* Tags */}
      {summary.tags?.length > 0 && (
        <Section title="Tags">
          <View className="flex-row flex-wrap gap-1.5">
            {summary.tags.map((tag) => (
              <View key={tag} className="bg-[#f3e8ff] dark:bg-[#3b1359] px-2.5 py-1 rounded-lg">
                <Text
                  className="text-xs font-medium text-[#9358c7]"
                  style={{ fontFamily: "DMSans" }}
                >
                  {tag}
                </Text>
              </View>
            ))}
          </View>
        </Section>
      )}
    </View>
  );
}
```

- [ ] **Step 2: Create summary detail screen**

`apps/mobile/app/summary/[id].tsx`:

```tsx
import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, SafeAreaView, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Summary } from "@cliphy/shared";
import { getSummary } from "../../lib/api";
import { SummaryContent } from "../../components/SummaryContent";
import { QueueCardSkeleton } from "../../components/Skeleton";
import { brutalShadowSm, getTheme } from "../../lib/theme";

export default function SummaryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const theme = getTheme();

  useEffect(() => {
    getSummary(id)
      .then((res) => setSummary(res.summary))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-[#1e1e1e]">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-[#e5e5e5] dark:border-[#3a3a3a]">
        <Pressable onPress={() => router.back()}>
          <Text className="text-sm font-bold text-[#9358c7]" style={{ fontFamily: "DMSans" }}>
            ← Back
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="px-4 py-4 gap-3">
          <QueueCardSkeleton />
          <QueueCardSkeleton />
        </View>
      ) : summary ? (
        <ScrollView contentContainerClassName="px-4 py-4">
          {/* Video info header */}
          <View
            className="border-2 border-black dark:border-[#505050] rounded-lg p-3 mb-5 bg-[#f8f8f8] dark:bg-[#252525]"
            style={brutalShadowSm(theme.shadowColor)}
          >
            <Text
              className="text-base font-bold text-[#111827] dark:text-white"
              style={{ fontFamily: "DMSans" }}
            >
              {summary.videoTitle}
            </Text>
            {summary.videoChannel && (
              <Text className="text-xs text-[#6b7280] mt-0.5" style={{ fontFamily: "DMSans" }}>
                {summary.videoChannel}
              </Text>
            )}
            {summary.videoUrl && (
              <Pressable onPress={() => Linking.openURL(summary.videoUrl!)} className="mt-2">
                <Text className="text-xs font-bold text-[#9358c7]" style={{ fontFamily: "DMSans" }}>
                  Watch on YouTube →
                </Text>
              </Pressable>
            )}
          </View>

          <SummaryContent summary={summary} />
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center">
          <Text className="text-[#6b7280]" style={{ fontFamily: "DMSans" }}>
            Summary not found
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Test detail screen**

Navigate to a completed summary, verify:

- Video title and channel render in a brutal card
- TL;DR, key points, timestamps, context section, tags all render
- Timestamp links open YouTube at correct time
- Back button works
- Dark mode looks correct

- [ ] **Step 4: Commit**

```bash
git add apps/mobile
git commit -m "add summary detail screen"
```

---

### Task 11: Share Extension (expo-share-intent)

**Files:**

- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/package.json`

- [ ] **Step 1: Install expo-share-intent**

```bash
cd apps/mobile && pnpm add expo-share-intent
```

- [ ] **Step 2: Configure share extension in app.json**

Add to `apps/mobile/app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-share-intent",
        {
          "iosActivationRules": {
            "NSExtensionActivationSupportsWebURLWithMaxCount": 1
          },
          "androidIntentFilters": ["text/*"]
        }
      ]
    ]
  }
}
```

- [ ] **Step 3: Handle share intent in root layout**

Update `apps/mobile/app/_layout.tsx` to handle incoming share intents:

```tsx
import { useShareIntent } from "expo-share-intent";
import { addToQueue } from "../lib/api";
import { Alert } from "react-native";

// Inside RootLayout component, after auth setup:
const { shareIntent, resetShareIntent } = useShareIntent();

useEffect(() => {
  if (!shareIntent?.text || !session) return;

  // Extract YouTube URL from shared text
  const urlMatch = shareIntent.text.match(
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/,
  );

  if (urlMatch) {
    const videoUrl = `https://www.youtube.com/watch?v=${urlMatch[1]}`;
    addToQueue({ videoUrl })
      .then((res) => {
        Alert.alert("Added to queue", res.summary.videoTitle || "Video queued for summary");
      })
      .catch((err) => {
        Alert.alert("Error", err.message);
      })
      .finally(() => {
        resetShareIntent();
      });
  } else {
    Alert.alert("Not a YouTube URL", "Share a YouTube video link to add it to your queue.");
    resetShareIntent();
  }
}, [shareIntent, session]);
```

- [ ] **Step 4: Test share extension**

This requires a development build (not Expo Go):

```bash
cd apps/mobile && npx expo prebuild && npx expo run:ios
```

Then:

1. Open YouTube app
2. Tap Share on any video
3. Select "Cliphy" from share sheet
4. Verify alert shows "Added to queue"
5. Open Cliphy app → video appears in queue

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "add share extension via expo-share-intent"
```

---

### Task 12: Clipboard URL Detection

**Files:**

- Create: `apps/mobile/lib/clipboard.ts`
- Modify: `apps/mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Create clipboard helper**

`apps/mobile/lib/clipboard.ts`:

```typescript
import * as Clipboard from "expo-clipboard";

const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/;

export async function getYouTubeUrlFromClipboard(): Promise<string | null> {
  try {
    const hasString = await Clipboard.hasStringAsync();
    if (!hasString) return null;

    const text = await Clipboard.getStringAsync();
    const match = text.match(YOUTUBE_REGEX);
    if (!match) return null;

    return `https://www.youtube.com/watch?v=${match[1]}`;
  } catch {
    return null;
  }
}
```

Install: `cd apps/mobile && pnpm add expo-clipboard`

- [ ] **Step 2: Add clipboard detection to Queue screen**

In `apps/mobile/app/(tabs)/index.tsx`, add to the QueueScreen component:

```tsx
import { AppState, Alert } from "react-native";
import { getYouTubeUrlFromClipboard } from "../../lib/clipboard";
import { addToQueue } from "../../lib/api";

// Inside QueueScreen, after existing state:
const [lastClipboardUrl, setLastClipboardUrl] = useState<string | null>(null);

// Check clipboard when app comes to foreground
useEffect(() => {
  const subscription = AppState.addEventListener("change", async (state) => {
    if (state !== "active") return;

    const url = await getYouTubeUrlFromClipboard();
    if (!url || url === lastClipboardUrl) return;

    setLastClipboardUrl(url);

    Alert.alert("YouTube link detected", "Add this video to your queue?", [
      { text: "No", style: "cancel" },
      {
        text: "Add",
        onPress: async () => {
          try {
            const res = await addToQueue({ videoUrl: url });
            Alert.alert("Added!", res.summary.videoTitle || "Video queued");
            fetchData(); // Refresh list
          } catch (err: any) {
            Alert.alert("Error", err.message);
          }
        },
      },
    ]);
  });

  return () => subscription.remove();
}, [lastClipboardUrl, fetchData]);
```

- [ ] **Step 3: Test clipboard detection**

1. Copy a YouTube URL
2. Switch to Cliphy app
3. Verify alert appears: "YouTube link detected — Add this video to your queue?"
4. Tap "Add" → video appears in queue
5. Switch away and back → should NOT prompt again for same URL

- [ ] **Step 4: Commit**

```bash
git add apps/mobile
git commit -m "add clipboard YouTube URL detection on app focus"
```

---

### Task 13: Supabase Realtime — Live Queue Updates

**Files:**

- Modify: `apps/mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Add realtime subscription to Queue screen**

In `apps/mobile/app/(tabs)/index.tsx`, add after the `fetchData` effect:

```tsx
import { supabase } from "../../lib/supabase";

// Inside QueueScreen:
useEffect(() => {
  let userId: string | null = null;

  supabase.auth.getSession().then(({ data }) => {
    userId = data.session?.user.id ?? null;
    if (!userId) return;

    const channel = supabase
      .channel("queue-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "summaries",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as Summary;

          if (payload.eventType === "INSERT") {
            setItems((prev) => [updated, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
          } else if (payload.eventType === "DELETE") {
            setItems((prev) => prev.filter((item) => item.id !== (payload.old as any).id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  });
}, []);
```

- [ ] **Step 2: Test realtime updates**

1. Open app with queue visible
2. Add a video from the Chrome extension
3. Verify it appears in the mobile queue without pull-to-refresh
4. Wait for it to be summarized — status should update from "Queued" → "Summarizing..." → "Done" live

- [ ] **Step 3: Commit**

```bash
git add apps/mobile
git commit -m "add Supabase Realtime for live queue updates"
```

---

### Task 14: Push Notifications — Server Endpoint

**Files:**

- Create: `apps/server/src/routes/devices.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/functions/summarize-video.ts`

This task adds a push token registration endpoint and sends notifications when summaries complete.

- [ ] **Step 1: Create devices table migration**

Create a new migration. Run in Supabase SQL Editor or as a migration file:

```sql
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, token)
);

CREATE INDEX push_tokens_user_id_idx ON push_tokens(user_id);
```

- [ ] **Step 2: Create devices route**

`apps/server/src/routes/devices.ts`:

```typescript
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";

const app = new Hono();

app.use("/*", authMiddleware);

// Register push token
app.post("/", async (c) => {
  const userId = c.get("userId");
  const { token, platform } = await c.req.json();

  if (!token || !platform) {
    return c.json({ error: "token and platform are required" }, 400);
  }

  if (!["ios", "android"].includes(platform)) {
    return c.json({ error: "platform must be ios or android" }, 400);
  }

  const { error } = await supabaseAdmin
    .from("push_tokens")
    .upsert({ user_id: userId, token, platform }, { onConflict: "user_id,token" });

  if (error) {
    return c.json({ error: "Failed to register token" }, 500);
  }

  return c.json({ registered: true });
});

// Unregister push token (for sign out)
app.delete("/", async (c) => {
  const userId = c.get("userId");
  const { token } = await c.req.json();

  await supabaseAdmin.from("push_tokens").delete().eq("user_id", userId).eq("token", token);

  return c.json({ removed: true });
});

export default app;
```

- [ ] **Step 3: Mount devices route**

In `apps/server/src/app.ts`, add:

```typescript
import devices from "./routes/devices";
app.route("/api/devices", devices);
```

- [ ] **Step 4: Send push notification on summary completion**

In `apps/server/src/functions/summarize-video.ts`, after the summary is saved with status "completed", add a step to send push notifications:

```typescript
// After: await supabaseAdmin.from("summaries").update({ status: "completed", ... })

await step.run("send-push-notification", async () => {
  const { data: tokens } = await supabaseAdmin
    .from("push_tokens")
    .select("token")
    .eq("user_id", userId);

  if (!tokens?.length) return;

  // Send via Expo Push API
  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default",
    title: "Summary ready!",
    body: videoTitle ? `"${videoTitle}" has been summarized` : "Your video summary is ready",
    data: { summaryId },
  }));

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/devices.ts apps/server/src/app.ts apps/server/src/functions/summarize-video.ts
git commit -m "add push token registration and notification on summary complete"
```

---

### Task 15: Push Notifications — Mobile Client

**Files:**

- Create: `apps/mobile/lib/notifications.ts`
- Modify: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Install expo-notifications**

```bash
cd apps/mobile && pnpm add expo-notifications expo-device expo-constants
```

- [ ] **Step 2: Create notification helper**

`apps/mobile/lib/notifications.ts`:

```typescript
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getAccessToken } from "./auth";

const API_URL = process.env.EXPO_PUBLIC_API_URL!;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log("Push notifications require a physical device");
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;

  // Register with our server
  const accessToken = await getAccessToken();
  if (accessToken) {
    await fetch(`${API_URL}/api/devices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        token,
        platform: Platform.OS,
      }),
    });
  }

  return token;
}

export async function unregisterPushToken(token: string) {
  const accessToken = await getAccessToken();
  if (!accessToken) return;

  await fetch(`${API_URL}/api/devices`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ token }),
  });
}
```

- [ ] **Step 3: Register for push in root layout**

In `apps/mobile/app/_layout.tsx`, after the auth state is established:

```tsx
import { registerForPushNotifications } from "../lib/notifications";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";

// Inside RootLayout, after session is set:
useEffect(() => {
  if (!session) return;
  registerForPushNotifications();
}, [session]);

// Handle notification tap — navigate to summary
useEffect(() => {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const summaryId = response.notification.request.content.data?.summaryId;
    if (summaryId) {
      router.push(`/summary/${summaryId}`);
    }
  });

  return () => subscription.remove();
}, [router]);
```

- [ ] **Step 4: Test push notifications**

Requires a physical device and a development build:

1. Build and install on device
2. Sign in → should see notification permission prompt
3. Queue a video from Chrome extension
4. Wait for summary to complete
5. Verify push notification arrives: "Summary ready! — '<video title>' has been summarized"
6. Tap notification → navigates to summary detail

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "add push notification registration and deep link on tap"
```

---

### Task 16: Upgrade Prompt + Billing (In-App Browser)

**Files:**

- Create: `apps/mobile/components/UpgradePrompt.tsx`
- Modify: `apps/mobile/app/(tabs)/settings.tsx`

- [ ] **Step 1: Create UpgradePrompt component**

`apps/mobile/components/UpgradePrompt.tsx`:

```tsx
import { View, Text, Pressable } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { createCheckout } from "../lib/api";
import { brutalShadowSm, getTheme } from "../lib/theme";
import { useState } from "react";

export function UpgradePrompt() {
  const theme = getTheme();
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
      className="border-2 border-black dark:border-[#505050] rounded-lg p-4 bg-[#f3e8ff] dark:bg-[#1e0030]"
      style={brutalShadowSm(theme.shadowColor)}
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
        className="px-4 py-2.5 border-2 border-black dark:border-[#505050] rounded-lg bg-[#9358c7] items-center"
        style={brutalShadowSm(theme.shadowColor)}
      >
        <Text className="text-white font-bold text-sm" style={{ fontFamily: "DMSans" }}>
          {loading ? "..." : "Upgrade to Pro"}
        </Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 2: Add upgrade prompt and manage subscription to Settings**

In `apps/mobile/app/(tabs)/settings.tsx`, add below the "Signed in as" card:

```tsx
import { UpgradePrompt } from "../../components/UpgradePrompt";
import { createPortal, getUsage } from "../../lib/api";
import * as WebBrowser from "expo-web-browser";

// Fetch user plan
const [plan, setPlan] = useState<string>("free");

useEffect(() => {
  getUsage().then((res) => setPlan(res.usage.plan));
}, []);

// In the JSX, after the "Signed in as" card:
{
  plan === "free" ? (
    <UpgradePrompt />
  ) : (
    <Pressable
      onPress={async () => {
        const { url } = await createPortal();
        await WebBrowser.openBrowserAsync(url);
      }}
      className="px-4 py-3 border-2 border-black dark:border-[#505050] rounded-lg bg-[#f8f8f8] dark:bg-[#252525] items-center mb-6"
      style={brutalShadowSm(theme.shadowColor)}
    >
      <Text
        className="font-bold text-sm text-[#111827] dark:text-white"
        style={{ fontFamily: "DMSans" }}
      >
        Manage Subscription
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 3: Test billing flow**

1. As a free user → upgrade prompt appears in Settings
2. Tap "Upgrade to Pro" → opens Stripe checkout in in-app browser
3. As a pro user → "Manage Subscription" button appears instead
4. Tap → opens Stripe customer portal

- [ ] **Step 4: Commit**

```bash
git add apps/mobile
git commit -m "add upgrade prompt and subscription management"
```

---

### Task 17: EAS Build Configuration + App Store Prep

**Files:**

- Modify: `apps/mobile/eas.json`
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Configure app.json for production**

Update `apps/mobile/app.json`:

```json
{
  "expo": {
    "name": "Cliphy",
    "slug": "cliphy",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "scheme": "com.cliphy.app",
    "userInterfaceStyle": "automatic",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.cliphy.app",
      "infoPlist": {
        "NSCameraUsageDescription": "Not used",
        "ITSAppUsesNonExemptEncryption": false
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": "com.cliphy.app"
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      [
        "expo-share-intent",
        {
          "iosActivationRules": {
            "NSExtensionActivationSupportsWebURLWithMaxCount": 1
          },
          "androidIntentFilters": ["text/*"]
        }
      ],
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#9358c7"
        }
      ]
    ],
    "extra": {
      "eas": {
        "projectId": "YOUR_EAS_PROJECT_ID"
      }
    }
  }
}
```

- [ ] **Step 2: Configure EAS Build**

`apps/mobile/eas.json`:

```json
{
  "cli": {
    "version": ">= 15.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "YOUR_APPLE_ID",
        "ascAppId": "YOUR_ASC_APP_ID",
        "appleTeamId": "YOUR_TEAM_ID"
      }
    }
  }
}
```

- [ ] **Step 3: Set env vars for EAS Build**

```bash
cd apps/mobile
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "YOUR_SUPABASE_URL"
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "YOUR_ANON_KEY"
eas secret:create --name EXPO_PUBLIC_API_URL --value "https://your-api.vercel.app"
```

- [ ] **Step 4: Create asset placeholders**

Create placeholder icon and splash images at:

- `apps/mobile/assets/icon.png` (1024x1024)
- `apps/mobile/assets/splash.png` (1284x2778)
- `apps/mobile/assets/adaptive-icon.png` (1024x1024)
- `apps/mobile/assets/notification-icon.png` (96x96, white on transparent)

These should use the Cliphy logo/brand. Port from the extension's existing icon assets.

- [ ] **Step 5: Run a preview build to verify**

```bash
cd apps/mobile && eas build --platform ios --profile preview
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile
git commit -m "configure EAS Build and App Store settings"
```

---

### Task 18: CORS — Allow Mobile App Origin

**Files:**

- Modify: `apps/server/src/app.ts` (or wherever CORS is configured)

- [ ] **Step 1: Check current CORS config**

Read the CORS middleware in the server. The mobile app makes requests from a different origin than the extension.

- [ ] **Step 2: Update CORS to allow mobile requests**

React Native `fetch` doesn't send an `Origin` header the same way browsers do. Requests come through as plain HTTP without CORS preflight in most cases. However, if the server has restrictive CORS:

- Add the mobile app's scheme/origin to `ALLOWED_ORIGINS`
- Or ensure the auth middleware doesn't block non-browser requests (Bearer token auth should work regardless of CORS)

Verify by testing an API call from the mobile app. If it works without CORS changes, no modification needed.

- [ ] **Step 3: Commit (if changes needed)**

```bash
git add apps/server/src/app.ts
git commit -m "allow mobile app requests in CORS config"
```

---

## Summary

| Task | What it does                                    |
| ---- | ----------------------------------------------- |
| 1    | Scaffold Expo app in monorepo                   |
| 2    | NativeWind + design tokens (neobrutalist theme) |
| 3    | DM Sans font loading                            |
| 4    | Supabase auth + secure token storage            |
| 5    | Google OAuth for mobile                         |
| 6    | Login screen UI                                 |
| 7    | Auth gate + tab navigation                      |
| 8    | API client (port from extension)                |
| 9    | Queue screen with pull-to-refresh               |
| 10   | Summary detail screen                           |
| 11   | Share extension (one-tap from YouTube)          |
| 12   | Clipboard URL detection                         |
| 13   | Supabase Realtime live updates                  |
| 14   | Push notifications — server endpoint            |
| 15   | Push notifications — mobile client              |
| 16   | Upgrade prompt + billing                        |
| 17   | EAS Build + App Store prep                      |
| 18   | CORS for mobile requests                        |

**Total:** 18 tasks. Tasks 1–10 get you a working app with auth and queue. Tasks 11–13 wire up the input flows (share sheet, clipboard, realtime). Tasks 14–18 handle notifications and production readiness.
