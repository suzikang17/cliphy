import "../polyfills";
import "../global.css";
import { useEffect, useRef, useState } from "react";
import { Alert, AppState, View, useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack, useRouter, useSegments } from "expo-router";
import { colors } from "@cliphy/shared";
import { useFonts } from "expo-font";
import { useShareIntent } from "expo-share-intent";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { addClip } from "../lib/api";
import { uploadAndClipImage } from "../lib/uploadImage";
import { showQueueError } from "../lib/queueError";
import { registerForPushNotifications } from "../lib/notifications";
import * as Notifications from "expo-notifications";
import { getCoachState, hydrateCoach, refreshCoach, resetCoach, useCoach } from "../lib/coachStore";
import {
  onNotificationReceived,
  onNotificationTapped,
  reconcilePresented,
  reportTimezone,
  syncLocalReminders,
} from "../lib/coachNotifications";
import { couldBeRequest, setPendingShare, type PendingShare } from "../lib/shareStore";
import { SendToChatSheet } from "../components/coach/SendToChatSheet";

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

  // Coach: find out whether this account has it. If so, tell the server our
  // timezone (it plans no reminders without one) and back up upcoming
  // reminders on the phone. Accounts without it make this one call and no more.
  useEffect(() => {
    if (!session) {
      resetCoach();
      return;
    }
    // Show what was saved last time first, so a launch with no network still
    // has Chat and the thread; then ask the server.
    hydrateCoach()
      .then(() => refreshCoach({ full: true }))
      .then(() => {
        if (getCoachState().status !== "on") return;
        void reportTimezone().then(syncLocalReminders);
      });
  }, [session]);

  // Each time the app comes to the front: retry if the server was unreachable,
  // notice pushes that arrived while it was not running, and bring the local
  // reminder backups up to date.
  useEffect(() => {
    if (!session) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || getCoachState().status === "off") return;
      void refreshCoach({ full: true }).then(() => {
        if (getCoachState().status !== "on") return;
        void reconcilePresented().then(syncLocalReminders);
      });
    });
    return () => sub.remove();
  }, [session]);

  // A reminder that arrives while the app is open is reported as delivered.
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      void onNotificationReceived(notification).then(() => refreshCoach());
    });
    return () => subscription.remove();
  }, []);

  // Handle notification tap — navigate to summary
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const summaryId = response.notification.request.content.data?.summaryId;
      if (summaryId) {
        router.push(`/summary/${summaryId}`);
        return;
      }
      // A coach reminder: tapping it counts as answered, and opens Chat.
      void onNotificationTapped(response).then((path) => {
        if (path) router.push(path as never);
      });
    });

    return () => subscription.remove();
  }, [router]);

  // Handle share intent (YouTube links shared from other apps)
  const { shareIntent, resetShareIntent } = useShareIntent();

  // Guards against the share-intent effect re-entering while an enqueue is
  // in flight. expo-share-intent keeps `shareIntent` populated until reset, so
  // any re-render in that window would otherwise queue the same video again.
  const processingShareRef = useRef(false);
  const coachStatus = useCoach().status;
  const coachAskedRef = useRef(false);
  const [shareTick, setShareTick] = useState(0);

  useEffect(() => {
    const hasText = Boolean(shareIntent?.text);
    const hasFiles = Boolean(shareIntent?.files?.length);
    if ((!hasText && !hasFiles) || !session || processingShareRef.current) return;

    // With the coach on, images or words that are more than a link might be a
    // request someone sent: ask whether it goes to Chat or to the Library.
    // A share that opens the app arrives before we know whether this account
    // has the coach. Ask once, then decide.
    if (coachStatus === "unknown" && !coachAskedRef.current) {
      coachAskedRef.current = true;
      void refreshCoach().finally(() => setShareTick((n) => n + 1));
      return;
    }
    if (coachStatus === "on") {
      const share: PendingShare = {
        text: shareIntent?.text ?? "",
        imageUris: (shareIntent?.files ?? [])
          .filter((f) => f.mimeType?.startsWith("image/"))
          .map((f) => f.path),
      };
      if (couldBeRequest(share)) {
        resetShareIntent();
        setPendingShare(share);
        return;
      }
    }

    // A shared image (screenshot, photo) → upload + OCR pipeline.
    const sharedImage = shareIntent?.files?.find((f) => f.mimeType?.startsWith("image/"));
    if (sharedImage) {
      resetShareIntent();
      processingShareRef.current = true;
      uploadAndClipImage(sharedImage.path)
        .then(() => Alert.alert("Saved to Cliphy", "Image saved"))
        .catch((err: unknown) => showQueueError(err))
        .finally(() => {
          processingShareRef.current = false;
        });
      return;
    }

    // Snapshot the text and clear the intent synchronously *before* the async
    // enqueue, so a re-render can't re-fire this effect for the same share.
    const sharedText = shareIntent?.text;
    resetShareIntent();
    if (!sharedText) return;

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
  }, [shareIntent, session, resetShareIntent, coachStatus, shareTick]);

  // "Save to Library" from the Send to Chat sheet: what sharing always did.
  const saveShareToLibrary = (share: PendingShare) => {
    if (share.imageUris.length > 0) {
      processingShareRef.current = true;
      Promise.all(share.imageUris.map((uri) => uploadAndClipImage(uri)))
        .then(() => Alert.alert("Saved to Cliphy", "Saved to Library"))
        .catch((err: unknown) => showQueueError(err))
        .finally(() => {
          processingShareRef.current = false;
        });
      return;
    }
    const url = share.text.match(/https?:\/\/[^\s]+/)?.[0];
    if (!url) {
      Alert.alert("No link found", "Share a link or an image to save it to Cliphy.");
      return;
    }
    addClip({ url })
      .then((res) => Alert.alert("Saved to Cliphy", res.clip.videoTitle || "Clip saved"))
      .catch((err: unknown) => showQueueError(err));
  };

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
        <SendToChatSheet onLibrary={saveShareToLibrary} />
      </View>
    </SafeAreaProvider>
  );
}
