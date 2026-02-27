import type { ExtensionMessage } from "@cliphy/shared";
import { extractVideoId } from "@cliphy/shared";
import type { Menus, Tabs, Runtime } from "wxt/browser";
import { signIn, signOut, isAuthenticated, getAccessToken, getUserIdFromToken } from "../lib/auth";
import { addToQueue } from "../lib/api";
import { startRealtimeSubscription, stopRealtimeSubscription } from "../lib/supabase";

/** Start listening for Realtime changes if authenticated. */
async function setupRealtime() {
  const token = await getAccessToken();
  if (!token) return;

  const userId = getUserIdFromToken(token);
  if (!userId) return;

  startRealtimeSubscription(
    userId,
    (summary) => {
      browser.runtime
        .sendMessage({
          type: "SUMMARY_UPDATED",
          summary,
        } satisfies ExtensionMessage)
        .catch(() => {
          // No listeners — sidepanel not open, that's fine
        });
    },
    token,
  );
}

export default defineBackground(() => {
  // ── Realtime setup on startup ──────────────────────────────
  setupRealtime();

  // ── Extension icon click: open side panel ────────────────
  browser.action.onClicked.addListener(async (tab: Tabs.Tab) => {
    if (tab.id) {
      await browser.sidePanel.open({ tabId: tab.id });
    }
  });

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
    const vid = url ? extractVideoId(url) : null;
    if (!url || !vid) return;

    try {
      await addToQueue({ videoUrl: url });
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
          return false; // No async response needed

        case "ADD_TO_QUEUE": {
          const authed = isAuthenticated();
          if (!authed) {
            sendResponse({ success: false, error: "Not authenticated" });
            return true;
          }

          console.log("[Cliphy] ADD_TO_QUEUE:", msg.videoUrl);

          addToQueue({
            videoUrl: msg.videoUrl,
            videoTitle: msg.videoTitle,
            videoChannel: msg.videoChannel,
            videoDurationSeconds: msg.videoDurationSeconds,
          })
            .then((result) => {
              sendResponse({ success: true, summary: result.summary });
            })
            .catch((err: Error) => {
              console.error("[Cliphy] addToQueue failed:", err);
              sendResponse({ success: false, error: err.message });
            });
          return true;
        }

        case "SIGN_IN":
          signIn()
            .then(() => {
              setupRealtime();
              sendResponse({ success: true });
            })
            .catch((err: Error) => sendResponse({ success: false, error: err.message }));
          return true;

        case "SIGN_OUT":
          stopRealtimeSubscription();
          signOut()
            .then(() => sendResponse({ success: true }))
            .catch((err: Error) => sendResponse({ success: false, error: err.message }));
          return true;
      }

      return false;
    },
  );
});
