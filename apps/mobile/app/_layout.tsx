import "../polyfills";
import "../global.css";
import { useEffect, useRef, useState } from "react";
import { Alert, View, useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack, useRouter, useSegments } from "expo-router";
import { colors } from "@cliphy/shared";
import { useFonts } from "expo-font";
import { useShareIntent } from "expo-share-intent";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { addClip } from "../lib/api";
import { showQueueError } from "../lib/queueError";
import { registerForPushNotifications } from "../lib/notifications";
import * as Notifications from "expo-notifications";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  const [fontsLoaded] = useFonts({
    /* eslint-disable @typescript-eslint/no-require-imports */
    DMSans: require("../assets/fonts/DMSans-Regular.ttf"),
    "DMSans-Medium": require("../assets/fonts/DMSans-Medium.ttf"),
    "DMSans-Bold": require("../assets/fonts/DMSans-Bold.ttf"),
    /* eslint-enable @typescript-eslint/no-require-imports */
  });

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
      })
      .catch((err) => {
        console.error("getSession failed:", err);
      })
      .finally(() => {
        setInitialized(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!initialized || !fontsLoaded) return;

    const inAuth = segments[0] === "(auth)";
    const atRoot = (segments as string[]).length === 0;
    // While on the password-reset screen, a recovery session exists but the user
    // hasn't set their new password yet — don't bounce them into the app.
    // reset.tsx navigates to (tabs) itself once the password is updated.
    const onReset = (segments as string[])[1] === "reset";

    if (!session && !inAuth) {
      router.replace("/(auth)/login");
    } else if (session && (inAuth || atRoot) && !onReset) {
      router.replace("/(tabs)");
    }
  }, [session, initialized, fontsLoaded, segments, router]);

  // Register for push notifications when signed in
  useEffect(() => {
    if (!session) return;
    registerForPushNotifications().catch(console.error);
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

  // Handle share intent (YouTube links shared from other apps)
  const { shareIntent, resetShareIntent } = useShareIntent();

  // Guards against the share-intent effect re-entering while an enqueue is
  // in flight. expo-share-intent keeps `shareIntent` populated until reset, so
  // any re-render in that window would otherwise queue the same video again.
  const processingShareRef = useRef(false);

  useEffect(() => {
    if (!shareIntent?.text || !session || processingShareRef.current) return;

    // Snapshot the text and clear the intent synchronously *before* the async
    // enqueue, so a re-render can't re-fire this effect for the same share.
    const sharedText = shareIntent.text;
    resetShareIntent();

    const urlMatch = sharedText.match(/https?:\/\/[^\s]+/);

    if (!urlMatch) {
      Alert.alert("No link found", "Share a link to save it to Cliphy.");
      return;
    }

    processingShareRef.current = true;
    addClip({ url: urlMatch[0] })
      .then((res) => {
        Alert.alert("Saved to Cliphy", res.clip.videoTitle || "Clip saved");
      })
      .catch((err: unknown) => {
        showQueueError(err);
      })
      .finally(() => {
        processingShareRef.current = false;
      });
  }, [shareIntent, session, resetShareIntent]);

  const colorScheme = useColorScheme();
  const bg = colorScheme === "dark" ? colors.dark.surface : colors.light.surface;

  if (!fontsLoaded || !initialized) return null;

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: bg }}>
        {/* Root Stack (not Slot) so pushed screens like summary/[id] get the
            native iOS edge-swipe-back gesture. headerShown stays off — each
            group/screen owns its chrome. The auth gate uses router.replace, so
            (tabs) sits at the stack root with nothing to swipe back to. */}
        <Stack
          screenOptions={{
            headerShown: false,
            gestureEnabled: true,
            contentStyle: { backgroundColor: bg },
          }}
        />
      </View>
    </SafeAreaProvider>
  );
}
