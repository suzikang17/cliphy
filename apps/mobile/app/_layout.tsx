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
import { shareOutbox } from "../lib/savedShares";
import { SendToChatSheet } from "../components/coach/SendToChatSheet";
import { DesktopShell } from "../components/coach/DesktopShell";
import { useCoachTheme } from "../components/coach/ui";
import { DESKTOP, MAC_WINDOW } from "../lib/desktop";
import { desktopEntry } from "../lib/coach";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  // The Mac window is never signed in here: the Mac app holds the key.
  const signedIn = MAC_WINDOW || Boolean(session);

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

    if (DESKTOP) {
      const onLibrary = (segments as string[]).length === 1 && segments[0] === "(tabs)";
      const entry = desktopEntry({ signedIn, starting: inAuth || atRoot || onLibrary });
      // On cliphy.app the website beside these screens does the signing in,
      // and holds the Library.
      if (entry === "sign-in") window.location.assign("/login");
      else if (entry === "chat") router.replace("/(tabs)/chat");
      return;
    }

    if (!session && !inAuth) {
      router.replace("/(auth)/login");
    } else if (session && (inAuth || atRoot) && !onReset) {
      router.replace("/(tabs)");
    }
  }, [session, signedIn, initialized, fontsLoaded, segments, router]);

  // Register for push notifications when signed in
  useEffect(() => {
    if (!session || DESKTOP) return;
    registerForPushNotifications().catch(console.error);
  }, [session]);

  // Coach: find out whether this account has it. If so, tell the server our
  // timezone (it plans no reminders without one) and back up upcoming
  // reminders on the phone. Accounts without it make this one call and no more.
  useEffect(() => {
    if (!signedIn) {
      resetCoach();
      return;
    }
    // Show what was saved last time first, so a launch with no network still
    // has Chat and the thread; then ask the server.
    hydrateCoach()
      .then(() => refreshCoach({ full: true }))
      .then(() => {
        if (getCoachState().status !== "on") return;
        // Reminders are the phone's job: the Mac neither keeps copies of them
        // nor says what timezone they are planned in.
        if (DESKTOP) return;
        void reportTimezone().then(syncLocalReminders);
      });
  }, [signedIn]);

  // Each time the app comes to the front: retry if the server was unreachable,
  // notice pushes that arrived while it was not running, and bring the local
  // reminder backups up to date.
  useEffect(() => {
    if (!signedIn) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || getCoachState().status === "off") return;
      void refreshCoach({ full: true }).then(() => {
        if (getCoachState().status !== "on" || DESKTOP) return;
        void reconcilePresented().then(syncLocalReminders);
      });
    });
    return () => sub.remove();
  }, [signedIn]);

  // A reminder that arrives while the app is open is reported as delivered.
  useEffect(() => {
    if (DESKTOP) return;
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      void onNotificationReceived(notification).then(() => refreshCoach());
    });
    return () => subscription.remove();
  }, []);

  // Handle notification tap — navigate to summary
  useEffect(() => {
    if (DESKTOP) return;
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

  // A shared link is stored on the phone and confirmed at once; the send to
  // the server follows in the background (lib/shareOutbox.ts).
  const saveSharedLink = (url: string) => {
    void shareOutbox
      .add(url)
      .then(() => {
        Alert.alert("Saved to Cliphy", "Clip saved");
        return shareOutbox.flush();
      })
      .catch((err: unknown) => showQueueError(err));
  };

  // Links still waiting from an earlier share (the app was put away, or there
  // was no network) go out when signed in and each time the app comes forward.
  useEffect(() => {
    if (!session || DESKTOP) return;
    void shareOutbox.flush();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void shareOutbox.flush();
    });
    return () => sub.remove();
  }, [session]);

  // On cliphy.app, an account without the coach has nothing to see here.
  useEffect(() => {
    if (DESKTOP && !MAC_WINDOW && coachStatus === "off") window.location.assign("/dashboard");
  }, [coachStatus]);
  const [shareTick, setShareTick] = useState(0);

  useEffect(() => {
    const hasText = Boolean(shareIntent?.text);
    const hasFiles = Boolean(shareIntent?.files?.length);
    if ((!hasText && !hasFiles) || !session || processingShareRef.current) return;

    // With the coach on, images or words that are more than a link might be a
    // request someone sent: ask whether it goes to Chat or to the Library.
    // A bare link is always a clip to save, so it never waits on the coach.
    const share: PendingShare = {
      text: shareIntent?.text ?? "",
      imageUris: (shareIntent?.files ?? [])
        .filter((f) => f.mimeType?.startsWith("image/"))
        .map((f) => f.path),
    };
    if (couldBeRequest(share)) {
      // A share that opens the app arrives before we know whether this
      // account has the coach. Ask once, then decide.
      if (coachStatus === "unknown" && !coachAskedRef.current) {
        coachAskedRef.current = true;
        void refreshCoach().finally(() => setShareTick((n) => n + 1));
        return;
      }
      if (coachStatus === "on") {
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

    saveSharedLink(urlMatch[0]);
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
    saveSharedLink(url);
  };

  const colorScheme = useColorScheme();
  const coachBg = useCoachTheme().bg;
  // The web build is all coach screens, which have their own dark background.
  const bg = DESKTOP
    ? coachBg
    : colorScheme === "dark"
      ? colors.dark.surface
      : colors.light.surface;

  if (!fontsLoaded || !initialized) return null;

  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        contentStyle: { backgroundColor: bg },
      }}
    />
  );

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: bg }}>
        {/* Root Stack (not Slot) so pushed screens like summary/[id] get the
            native iOS edge-swipe-back gesture. headerShown stays off — each
            group/screen owns its chrome. The auth gate uses router.replace, so
            (tabs) sits at the stack root with nothing to swipe back to. */}
        {DESKTOP ? <DesktopShell>{stack}</DesktopShell> : stack}
        <SendToChatSheet onLibrary={saveShareToLibrary} />
      </View>
    </SafeAreaProvider>
  );
}
