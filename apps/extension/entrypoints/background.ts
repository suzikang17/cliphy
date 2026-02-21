import type { ExtensionMessage } from "@cliphy/shared";
import { extractVideoId } from "@cliphy/shared";
import type { Menus, Tabs, Runtime } from "wxt/browser";
import { signIn, signOut, isAuthenticated } from "../lib/auth";
import { addToQueue, processQueueItem } from "../lib/api";

/** Queue a video and process it. Returns the completed summary or throws. */
async function queueAndProcess(videoUrl: string) {
  const { summary } = await addToQueue({ videoUrl });
  const { summary: processed } = await processQueueItem(summary.id);
  return processed;
}

export default defineBackground(() => {
  // ── Context menu ──────────────────────────────────────────
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: "add-to-cliphy",
      title: "Add to Cliphy",
      contexts: ["page"],
      documentUrlPatterns: ["*://*.youtube.com/watch*"],
    });
  });

  browser.contextMenus.onClicked.addListener(async (info: Menus.OnClickData, tab?: Tabs.Tab) => {
    if (info.menuItemId !== "add-to-cliphy") return;

    const url = info.pageUrl ?? tab?.url;
    if (!url || !extractVideoId(url)) return;

    try {
      await queueAndProcess(url);
    } catch (err) {
      console.error("[Cliphy] Context menu queue failed:", err);
    }
  });

  // ── Message handling ──────────────────────────────────────
  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: Runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => {
      const msg = message as ExtensionMessage;

      switch (msg.type) {
        case "VIDEO_DETECTED":
          console.log("[Cliphy] Video detected:", msg.video.videoId);
          break;

        case "ADD_TO_QUEUE": {
          const authed = isAuthenticated();
          if (!authed) {
            sendResponse({ success: false, error: "Not authenticated" });
            return true;
          }

          queueAndProcess(msg.videoUrl)
            .then((summary) => sendResponse({ success: true, summary }))
            .catch((err: Error) => sendResponse({ success: false, error: err.message }));
          return true;
        }

        case "SIGN_IN":
          signIn()
            .then(() => sendResponse({ success: true }))
            .catch((err: Error) => sendResponse({ success: false, error: err.message }));
          return true;

        case "SIGN_OUT":
          signOut()
            .then(() => sendResponse({ success: true }))
            .catch((err: Error) => sendResponse({ success: false, error: err.message }));
          return true;
      }

      return true;
    },
  );
});
