import type { ExtensionMessage, VideoInfo } from "@cliphy/shared";
import type { Runtime } from "wxt/browser";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],

  main() {
    function getVideoInfo(): VideoInfo {
      const url = window.location.href;
      const videoId = new URL(url).searchParams.get("v");
      const title = document.title.replace(" - YouTube", "");

      const channelEl =
        document.querySelector<HTMLAnchorElement>("ytd-channel-name a") ??
        document.querySelector<HTMLAnchorElement>("#owner a");
      const channel = channelEl?.textContent?.trim() ?? null;

      const durationEl = document.querySelector("span.ytp-time-duration");
      const duration = durationEl?.textContent?.trim() ?? null;

      return { videoId, title, url, channel, duration };
    }

    function isVideoPage(): boolean {
      return new URL(window.location.href).searchParams.has("v");
    }

    function notifyBackground(video: VideoInfo) {
      browser.runtime.sendMessage({
        type: "VIDEO_DETECTED",
        video,
      } satisfies ExtensionMessage);
    }

    // Listen for on-demand requests from popup / side panel / background
    browser.runtime.onMessage.addListener(
      (
        message: unknown,
        _sender: Runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ) => {
        const msg = message as ExtensionMessage;

        if (msg.type === "GET_VIDEO_INFO") {
          sendResponse(getVideoInfo());
          return false;
        }

        if (msg.type === "SEEK_VIDEO") {
          const video = document.querySelector("video");
          if (video) {
            video.currentTime = msg.seconds;
          }
          return false;
        }

        return false;
      },
    );

    // Detect SPA navigation (YouTube fires this on page transitions)
    document.addEventListener("yt-navigate-finish", () => {
      if (isVideoPage()) {
        // Small delay to let DOM update with new video's metadata
        setTimeout(() => {
          notifyBackground(getVideoInfo());
        }, 500);
      }
    });

    // Also detect initial page load if already on a video
    if (isVideoPage()) {
      setTimeout(() => {
        notifyBackground(getVideoInfo());
      }, 1000);
    }
  },
});
