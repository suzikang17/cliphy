import { Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { AuthError, RateLimitError, ProRequiredError, DuplicateError, createCheckout } from "./api";

async function startUpgrade() {
  try {
    const { url } = await createCheckout();
    await WebBrowser.openBrowserAsync(url);
  } catch (err) {
    console.error("Checkout error:", err);
    Alert.alert("Error", "Couldn't open checkout. Try again from Settings.");
  }
}

/**
 * Surface a queue-add failure as a friendly, actionable Alert.
 * Converts typed API errors into upgrade prompts instead of raw messages.
 */
export function showQueueError(err: unknown) {
  if (err instanceof RateLimitError) {
    const onFree = err.plan === "free";
    Alert.alert(
      "Monthly limit reached",
      onFree
        ? `You've used all ${err.limit} free summaries this month. Upgrade to Pro for 100/month.`
        : `You've reached your monthly limit of ${err.limit} summaries.`,
      onFree
        ? [
            { text: "Not now", style: "cancel" },
            { text: "Upgrade to Pro", onPress: startUpgrade },
          ]
        : [{ text: "OK" }],
    );
    return;
  }

  if (err instanceof ProRequiredError) {
    Alert.alert("Pro feature", `${err.feature} is available on Pro. Upgrade to unlock it.`, [
      { text: "Not now", style: "cancel" },
      { text: "Upgrade to Pro", onPress: startUpgrade },
    ]);
    return;
  }

  if (err instanceof AuthError) {
    Alert.alert("Session expired", "Please sign in again to continue.");
    return;
  }

  if (err instanceof DuplicateError) {
    Alert.alert("Already in your queue", "This video is already queued for a summary.");
    return;
  }

  Alert.alert("Error", err instanceof Error ? err.message : "Failed to add to queue");
}
