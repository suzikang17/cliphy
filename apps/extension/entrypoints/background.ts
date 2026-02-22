import type { ExtensionMessage, Summary } from "@cliphy/shared";
import { extractVideoId } from "@cliphy/shared";
import type { Menus, Tabs, Runtime } from "wxt/browser";
import { signIn, signOut, isAuthenticated, getAccessToken } from "../lib/auth";
import { addToQueue } from "../lib/api";
import { startRealtimeSubscription, stopRealtimeSubscription } from "../lib/supabase";
import { fetchTranscript } from "../lib/transcript";

/** Decode a JWT payload without verification (just base64). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

/** Map a DB row (snake_case) from Realtime payload to a Summary (camelCase). */
function toSummary(row: Record<string, unknown>): Summary {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    videoId: row.youtube_video_id as string,
    videoTitle: (row.video_title as string) ?? undefined,
    videoUrl: (row.video_url as string) ?? undefined,
    status: row.status as Summary["status"],
    summaryJson: (row.summary_json as Summary["summaryJson"]) ?? undefined,
    errorMessage: (row.error_message as string) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Start listening for Realtime changes if authenticated. */
async function setupRealtime() {
  const token = await getAccessToken();
  if (!token) return;

  try {
    const payload = decodeJwtPayload(token);
    const userId = payload.sub as string;
    if (!userId) return;

    startRealtimeSubscription(userId, (row) => {
      const summary = toSummary(row);
      browser.runtime
        .sendMessage({
          type: "SUMMARY_UPDATED",
          summary,
        } satisfies ExtensionMessage)
        .catch(() => {
          // No listeners — popup/sidepanel not open, that's fine
        });
    });
  } catch {
    // Invalid token or decode failure — skip Realtime
  }
}

export default defineBackground(() => {
  // ── Realtime setup on startup ──────────────────────────────
  setupRealtime();

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
      const transcript = await fetchTranscript(vid).catch(() => undefined);
      await addToQueue({ videoUrl: url, transcript });
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

          const videoId = extractVideoId(msg.videoUrl);
          (videoId ? fetchTranscript(videoId).catch(() => undefined) : Promise.resolve(undefined))
            .then((transcript) => addToQueue({ videoUrl: msg.videoUrl, transcript }))
            .then((result) => sendResponse({ success: true, summary: result.summary }))
            .catch((err: Error) => sendResponse({ success: false, error: err.message }));
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
