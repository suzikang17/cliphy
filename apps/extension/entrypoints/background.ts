import type { ExtensionMessage } from "@cliphy/shared";
import { signIn, signOut } from "../lib/auth";

export default defineBackground(() => {
  console.log("Cliphy extension installed");

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message as ExtensionMessage;

    switch (msg.type) {
      case "VIDEO_DETECTED":
        console.log("[Cliphy] Video detected:", msg.video);
        // TODO: integrate with queue system
        break;

      case "ADD_TO_QUEUE":
        // TODO: Send video to backend queue
        sendResponse({ success: true });
        break;

      case "SIGN_IN":
        signIn()
          .then(() => sendResponse({ success: true }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true; // keep port open for async response

      case "SIGN_OUT":
        signOut()
          .then(() => sendResponse({ success: true }))
          .catch((err: Error) => sendResponse({ success: false, error: err.message }));
        return true;
    }

    return true;
  });
});
