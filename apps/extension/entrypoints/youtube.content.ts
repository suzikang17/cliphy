import type { ExtensionMessage, VideoInfo } from "@cliphy/shared";
import type { Runtime } from "wxt/browser";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],

  main() {
    function formatDuration(totalSeconds: number): string {
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;
      return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${m}:${String(s).padStart(2, "0")}`;
    }

    function getDuration(): string | null {
      // Prefer video element duration (updates on SPA nav), but not during ads
      const isAd = !!document.querySelector(".ad-showing");
      if (!isAd) {
        const videoEl = document.querySelector("video");
        if (videoEl && isFinite(videoEl.duration) && videoEl.duration > 0) {
          return formatDuration(Math.floor(videoEl.duration));
        }
      }

      // Fallback: structured data meta tag (works on initial load, stale on SPA nav)
      const durationMeta = document.querySelector<HTMLMetaElement>('meta[itemprop="duration"]');
      if (durationMeta?.content) {
        const match = durationMeta.content.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (match) {
          const h = parseInt(match[1] ?? "0", 10);
          const m = parseInt(match[2] ?? "0", 10);
          const s = parseInt(match[3] ?? "0", 10);
          return formatDuration(h * 3600 + m * 60 + s);
        }
      }

      return null;
    }

    function getVideoInfo(): VideoInfo {
      const url = window.location.href;
      const videoId = new URL(url).searchParams.get("v");
      const title = document.title.replace(" - YouTube", "");

      const channelEl =
        document.querySelector<HTMLAnchorElement>("ytd-channel-name a") ??
        document.querySelector<HTMLAnchorElement>("#owner a");
      const channel = channelEl?.textContent?.trim() ?? null;

      const duration = getDuration();

      // .ytp-live class is only present on active livestreams, not past VODs
      const isLive = document.querySelector(".ytp-live") !== null;

      return { videoId, title, url, channel, duration, isLive };
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

    // Detect SPA navigation (YouTube fires this on page transitions).
    // On SPA nav, the URL updates instantly but DOM metadata (title, channel,
    // duration meta tag) still reflects the previous video. The <video> element
    // duration updates once the new video loads.
    document.addEventListener("yt-navigate-finish", () => {
      if (!isVideoPage()) return;

      const oldTitle = document.title;

      // Send immediately — videoId/URL are correct but null out channel/duration
      // which are still stale from the previous video
      const videoId = new URL(window.location.href).searchParams.get("v");
      notifyBackground({
        videoId,
        title: "",
        url: window.location.href,
        channel: null,
        duration: null,
        isLive: false,
      });

      // Poll until YouTube updates the DOM (title change = reliable signal)
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        if (document.title !== oldTitle || attempts >= 12) {
          clearInterval(poll);
          // Extra delay for video element to load (duration source)
          setTimeout(() => notifyBackground(getVideoInfo()), 500);
        }
      }, 500);
    });

    // Also detect initial page load if already on a video
    if (isVideoPage()) {
      setTimeout(() => {
        notifyBackground(getVideoInfo());
      }, 1000);
    }
  },
});
