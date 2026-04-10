import "../global.css";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { Slot, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import { useShareIntent } from "expo-share-intent";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { addToQueue } from "../lib/api";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  const [fontsLoaded] = useFonts({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    DMSans: require("../assets/fonts/DMSans-Variable.ttf"),
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
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

    if (!session && !inAuth) {
      router.replace("/(auth)/login");
    } else if (session && inAuth) {
      router.replace("/(tabs)");
    }
  }, [session, initialized, fontsLoaded, segments, router]);

  // Handle share intent (YouTube links shared from other apps)
  const { shareIntent, resetShareIntent } = useShareIntent();

  useEffect(() => {
    if (!shareIntent?.text || !session) return;

    const urlMatch = shareIntent.text.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/,
    );

    if (urlMatch) {
      const videoUrl = `https://www.youtube.com/watch?v=${urlMatch[1]}`;
      addToQueue({ videoUrl })
        .then((res) => {
          Alert.alert("Added to queue", res.summary.videoTitle || "Video queued for summary");
        })
        .catch((err: unknown) => {
          Alert.alert("Error", err instanceof Error ? err.message : "Failed to add");
        })
        .finally(() => {
          resetShareIntent();
        });
    } else {
      Alert.alert("Not a YouTube URL", "Share a YouTube video link to add it to your queue.");
      resetShareIntent();
    }
  }, [shareIntent, session, resetShareIntent]);

  if (!fontsLoaded || !initialized) return null;

  return <Slot />;
}
