import type { ExtensionMessage, QueueMetadata, ShowToastMessage } from "@cliphy/shared";
import { extractVideoId } from "@cliphy/shared";
import type { Menus, Tabs, Runtime } from "wxt/browser";
import { signIn, signOut, isAuthenticated, getAccessToken, getUserIdFromToken } from "../lib/auth";
import { addToQueue, RateLimitError, ProRequiredError } from "../lib/api";
import { startRealtimeSubscription, stopRealtimeSubscription } from "../lib/supabase";
import { createBackgroundClient } from "../lib/sentry";

const sentryScope = createBackgroundClient();

/**
 * Ask the content script for scraped metadata (title/channel/duration) of a video.
 * Returns an empty object if the tab has no content script (non-YouTube tab) or the
 * video isn't known — the queue still works with just the URL.
 */
async function getQueueMetadata(
  tabId: number | undefined,
  videoUrl: string,
): Promise<QueueMetadata> {
  if (tabId == null) return {};
  try {
    const meta = (await browser.tabs.sendMessage(tabId, {
      type: "GET_QUEUE_METADATA",
      videoUrl,
    } satisfies ExtensionMessage)) as QueueMetadata | undefined;
    return meta ?? {};
  } catch {
    return {};
  }
}

/** Fire a toast in the given tab's content script. No-op if the tab has none. */
function notifyTab(tabId: number | undefined, toast: ShowToastMessage) {
  if (tabId == null) return;
  browser.tabs.sendMessage(tabId, toast).catch(() => {
    // No content script in this tab (not a YouTube page) — badge feedback still applies.
  });
}

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
    // On a watch page: "Add to Cliphy" queues the current video
    browser.contextMenus.create({
      id: "add-to-cliphy",
      title: "Add to Cliphy",
      contexts: ["page"],
      documentUrlPatterns: ["*://*.youtube.com/watch*"],
    });
    // On any YouTube video link (thumbnails, titles, sidebar): queue that video.
    // Works everywhere — search, home, channel, sidebar — without DOM injection.
    browser.contextMenus.create({
      id: "add-link-to-cliphy",
      title: "Add to Cliphy",
      contexts: ["link"],
      targetUrlPatterns: ["*://*.youtube.com/watch*", "*://*.youtube.com/shorts/*"],
    });
  });

  browser.contextMenus.onClicked.addListener(async (info: Menus.OnClickData, tab?: Tabs.Tab) => {
    if (info.menuItemId !== "add-to-cliphy" && info.menuItemId !== "add-link-to-cliphy") return;

    // Link context gives us the right-clicked video; page context gives the current page.
    const url =
      info.menuItemId === "add-link-to-cliphy" ? info.linkUrl : (info.pageUrl ?? tab?.url);
    const vid = url ? extractVideoId(url) : null;
    if (!url || !vid) return;

    // Pull scraped metadata (title/channel/duration) from the content script as a
    // fast-path; the server also backfills title/channel via oEmbed if these are missing.
    const metadata = await getQueueMetadata(tab?.id, url);

    try {
      await addToQueue({ videoUrl: url, ...metadata });
      // Flash green "+" badge for 2s on success
      await browser.action.setBadgeBackgroundColor({ color: "#e6007e" });
      await browser.action.setBadgeText({ text: "+" });
      setTimeout(() => browser.action.setBadgeText({ text: "" }), 2000);
      notifyTab(tab?.id, {
        type: "SHOW_TOAST",
        message: "Added to queue",
        linkLabel: "Open Cliphy →",
      });
    } catch (err) {
      // Flash red "!" badge for 3s on error
      await browser.action.setBadgeBackgroundColor({ color: "#dc2626" });
      await browser.action.setBadgeText({ text: "!" });
      setTimeout(() => browser.action.setBadgeText({ text: "" }), 3000);

      if (err instanceof RateLimitError) {
        notifyTab(tab?.id, {
          type: "SHOW_TOAST",
          message: "Monthly limit reached — upgrade to Pro",
          linkLabel: "Open Cliphy →",
          variant: "error",
        });
      } else if (err instanceof ProRequiredError) {
        notifyTab(tab?.id, {
          type: "SHOW_TOAST",
          message: "Pro plan required — upgrade to continue",
          linkLabel: "Open Cliphy →",
          variant: "error",
        });
      } else {
        notifyTab(tab?.id, { type: "SHOW_TOAST", message: "Something went wrong — try again" });
        sentryScope?.captureException(err instanceof Error ? err : new Error(String(err)));
      }
      console.error("[Cliphy] Context menu queue failed:", err);
    }
  });

  // ── Message handling ──────────────────────────────────────
  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: Runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => {
      const msg = message as ExtensionMessage;

      switch (msg.type) {
        case "VIDEO_DETECTED":
          console.log("[Cliphy] Video detected:", msg.video.videoId);
          return false; // No async response needed

        case "ADD_TO_QUEUE": {
          const tabId = sender.tab?.id;
          (async () => {
            const authed = await isAuthenticated();
            if (!authed) {
              sendResponse({ success: false, error: "Not authenticated" });
              return;
            }

            // Respond before the API call — the service worker can be killed mid-flight
            // causing the port to close and the content script to show a false "Reload" error.
            // The sidepanel picks up queued items via realtime subscription regardless.
            sendResponse({ success: true });

            console.log("[Cliphy] ADD_TO_QUEUE:", msg.videoUrl);

            try {
              await addToQueue({
                videoUrl: msg.videoUrl,
                videoTitle: msg.videoTitle,
                videoChannel: msg.videoChannel,
                videoDurationSeconds: msg.videoDurationSeconds,
              });
            } catch (err) {
              console.error("[Cliphy] addToQueue failed:", err);
              const message = err instanceof Error ? err.message : String(err);
              if (tabId != null && err instanceof RateLimitError) {
                browser.tabs.sendMessage(tabId, {
                  type: "SHOW_TOAST",
                  message: "Monthly limit reached — upgrade to Pro",
                  linkLabel: "Open Cliphy →",
                  variant: "error",
                } satisfies import("@cliphy/shared").ShowToastMessage);
              } else if (tabId != null && err instanceof ProRequiredError) {
                browser.tabs.sendMessage(tabId, {
                  type: "SHOW_TOAST",
                  message: "Pro plan required — upgrade to continue",
                  linkLabel: "Open Cliphy →",
                  variant: "error",
                } satisfies import("@cliphy/shared").ShowToastMessage);
              } else if (message === "Video already queued" && tabId != null) {
                browser.tabs.sendMessage(tabId, {
                  type: "SHOW_TOAST",
                  message: "Already in your queue",
                } satisfies import("@cliphy/shared").ShowToastMessage);
              } else {
                sentryScope?.captureException(err instanceof Error ? err : new Error(message));
              }
            }
          })();
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

        case "SETUP_REALTIME":
          setupRealtime()
            .then(() => sendResponse({ success: true }))
            .catch((err: Error) => sendResponse({ success: false, error: err.message }));
          return true;

        case "OPEN_SIDEPANEL": {
          const tabId = sender.tab?.id;
          if (tabId) {
            browser.sidePanel.open({ tabId }).catch(() => {});
          }
          sendResponse({ success: true });
          return false;
        }
      }

      return false;
    },
  );
});
