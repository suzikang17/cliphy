import type { ExtensionMessage, VideoInfo, QueueMetadata } from "@cliphy/shared";
import type { Runtime } from "wxt/browser";
import { parseDurationToSeconds } from "../lib/duration";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],

  main() {
    // ── Injected styles ───────────────────────────────────────────
    const style = document.createElement("style");
    style.textContent = `
      /* Cliphy action button — inherits YouTube's tonal button styles */
      .cliphy-btn { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; vertical-align: middle; }
      .cliphy-btn:disabled { opacity: 0.5; cursor: default; }
      .cliphy-btn img { width: 16px; height: 16px; display: block; }

      /* Player overlay: pill-shaped dark button */
      #cliphy-player-btn {
        background: rgba(0,0,0,0.72) !important;
        color: #fff !important;
        border: none !important;
        border-radius: 50px !important;
        padding: 8px 16px !important;
        font-size: 14px !important;
        font-weight: 500 !important;
        font-family: "Roboto", Arial, sans-serif !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.5) !important;
        transition: background 0.15s, transform 0.15s, box-shadow 0.15s !important;
      }
      #cliphy-player-btn:hover {
        background: rgba(255,255,255,0.92) !important;
        color: #0f0f0f !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
        transform: scale(1.04);
      }

      #cliphy-player-btn {
        position: absolute;
        top: 12px;
        right: 12px;
        z-index: 60;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s;
      }
      #movie_player:hover #cliphy-player-btn,
      #movie_player.ytp-autohide #cliphy-player-btn { opacity: 0; pointer-events: none; }
      #movie_player:not(.ytp-autohide):hover #cliphy-player-btn { opacity: 1; pointer-events: auto; }


      #cliphy-toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        background: #212121;
        color: #fff;
        border-radius: 8px;
        font-family: "Roboto", Arial, sans-serif;
        font-size: 13px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.2s, transform 0.2s;
        pointer-events: none;
      }
      #cliphy-toast.cliphy-toast--visible {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      #cliphy-toast.cliphy-toast--error {
        border-left: 3px solid #e6007e;
        padding-left: 13px;
        font-size: 14px;
        font-weight: 500;
      }
      #cliphy-toast a {
        color: #3ea6ff;
        text-decoration: none;
        font-weight: 500;
        white-space: nowrap;
      }
      #cliphy-toast.cliphy-toast--error a {
        color: #e6007e;
      }
      #cliphy-toast a:hover { text-decoration: underline; }
    `;
    document.head.appendChild(style);

    // ── Toast ────────────────────────────────────────────────────
    const toast = document.createElement("div");
    toast.id = "cliphy-toast";
    toast.innerHTML = `<span id="cliphy-toast-msg"></span><a id="cliphy-toast-link" href="#" style="display:none">Open Cliphy →</a>`;
    document.body.appendChild(toast);

    const toastMsg = toast.querySelector<HTMLSpanElement>("#cliphy-toast-msg")!;
    const toastLink = toast.querySelector<HTMLAnchorElement>("#cliphy-toast-link")!;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    toastLink.addEventListener("click", (e) => {
      e.preventDefault();
      safeSendMessage({ type: "OPEN_SIDEPANEL" } satisfies ExtensionMessage);
    });

    function showToast(message: string, linkLabel?: string, variant?: "error") {
      if (toastTimer) clearTimeout(toastTimer);
      toastMsg.textContent = message;
      if (linkLabel) {
        toastLink.textContent = linkLabel;
        toastLink.style.display = "inline";
      } else {
        toastLink.style.display = "none";
      }
      toast.classList.toggle("cliphy-toast--error", variant === "error");
      toast.classList.add("cliphy-toast--visible");
      toastTimer = setTimeout(
        () => {
          toast.classList.remove("cliphy-toast--visible");
          toastTimer = null;
        },
        variant === "error" ? 5000 : 3000,
      );
    }

    type QueueResponse = { success: boolean; error?: string; code?: string } | null;

    function handleQueueResponse(
      response: QueueResponse,
      onSuccess: () => void,
      onFailure: () => void,
    ) {
      if (!response) {
        // Extension context invalidated — old content script still in DOM
        showToast("Reload the page to re-enable Cliphy");
        onFailure();
        return;
      }
      if (response.success) {
        onSuccess();
        return;
      }
      onFailure();
      if (response.code === "rate_limited") {
        showToast("Monthly limit reached — upgrade to Pro", "Open Cliphy →", "error");
      } else if (response.code === "pro_required") {
        showToast("Pro plan required — upgrade to continue", "Open Cliphy →", "error");
      } else if (response.error === "Not authenticated") {
        showToast("Sign in to Cliphy to summarize videos", "Sign in →");
      } else {
        showToast("Something went wrong — try again");
      }
    }

    // ── Session queue state ──────────────────────────────────────
    const queuedVideoIds = new Set<string>();

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

    function safeSendMessage(msg: ExtensionMessage): Promise<unknown> {
      if (!browser.runtime?.id) return Promise.resolve(null);
      return browser.runtime.sendMessage(msg).catch(() => null);
    }

    function notifyBackground(video: VideoInfo) {
      safeSendMessage({ type: "VIDEO_DETECTED", video } satisfies ExtensionMessage);
    }

    // ── DOM helpers ──────────────────────────────────────────────
    function waitForElement(selector: string, timeoutMs = 5000): Promise<Element | null> {
      return new Promise((resolve) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const observer = new MutationObserver(() => {
          const found = document.querySelector(selector);
          if (found) {
            observer.disconnect();
            resolve(found);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, timeoutMs);
      });
    }

    // ── Video player overlay button ────────────────────────────
    async function injectVideoOverlay() {
      document.getElementById("cliphy-player-btn")?.remove();

      if (!isVideoPage()) return;
      const info = getVideoInfo();
      if (!info.videoId || info.isLive) return;

      const player = (await waitForElement("#movie_player")) as HTMLElement | null;
      if (!player) return;

      if (document.getElementById("cliphy-player-btn")) return;

      if (getComputedStyle(player).position === "static") {
        player.style.position = "relative";
      }

      const iconUrl = browser.runtime.getURL("/icons/icon-128.png");
      const btn = document.createElement("button");
      btn.id = "cliphy-player-btn";
      btn.className = "cliphy-btn";

      const alreadyQueued = queuedVideoIds.has(info.videoId);
      btn.innerHTML = alreadyQueued ? `✓ Added` : `<img src="${iconUrl}" alt="" /> Add to Cliphy`;
      btn.disabled = alreadyQueued;

      btn.addEventListener("click", async () => {
        const currentInfo = getVideoInfo();
        if (!currentInfo.videoId) return;

        btn.disabled = true;
        btn.textContent = "Adding…";

        const durationSeconds = currentInfo.duration
          ? parseDurationToSeconds(currentInfo.duration)
          : undefined;

        const response = (await safeSendMessage({
          type: "ADD_TO_QUEUE",
          videoUrl: currentInfo.url,
          videoTitle: currentInfo.title || undefined,
          videoChannel: currentInfo.channel || undefined,
          videoDurationSeconds: durationSeconds || undefined,
        } satisfies ExtensionMessage)) as QueueResponse;

        handleQueueResponse(
          response,
          () => {
            queuedVideoIds.add(currentInfo.videoId!);
            btn.innerHTML = `✓ Added`;
            showToast("Added to queue", "Open Cliphy →");
          },
          () => {
            btn.innerHTML = `<img src="${iconUrl}" alt="" /> Add to Cliphy`;
            btn.disabled = false;
          },
        );
      });

      player.appendChild(btn);
    }

    // ── Video metadata scraping (for right-click context menu) ────
    const VIDEO_RENDERERS =
      "ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-rich-grid-media, yt-lockup-view-model";

    interface ThumbnailData {
      videoId: string;
      title?: string;
      channel?: string;
      durationSeconds?: number;
      url: string;
    }

    function extractThumbnailData(el: Element): ThumbnailData | null {
      // yt-lockup-view-model (new sidebar) doesn't use a#thumbnail
      const anchor =
        el.querySelector<HTMLAnchorElement>("a#thumbnail") ??
        el.querySelector<HTMLAnchorElement>("a[href*='/watch?v=']");
      if (!anchor?.href) return null;

      let videoId: string | null;
      try {
        videoId = new URL(anchor.href).searchParams.get("v");
      } catch {
        return null;
      }
      if (!videoId) return null;

      const titleEl =
        el.querySelector<HTMLElement>("#video-title-link") ??
        el.querySelector<HTMLElement>("#video-title") ??
        el.querySelector<HTMLElement>("yt-lockup-metadata-view-model h3") ??
        el.querySelector<HTMLElement>("[data-testid*='title']");
      const channelEl =
        el.querySelector<HTMLElement>("ytd-channel-name a") ??
        el.querySelector<HTMLElement>(".ytd-channel-name") ??
        el.querySelector<HTMLElement>("yt-content-metadata-view-model");
      const durationEl = el.querySelector<HTMLElement>(
        ".ytd-thumbnail-overlay-time-status-renderer span, " +
          "#text.ytd-thumbnail-overlay-time-status-renderer, " +
          ".badge-shape-wiz__text",
      );

      const durationText = durationEl?.textContent?.trim() ?? "";
      const durationSeconds = durationText ? parseDurationToSeconds(durationText) : undefined;

      return {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: titleEl?.textContent?.trim() || undefined,
        channel: channelEl?.textContent?.trim() || undefined,
        durationSeconds: durationSeconds || undefined,
      };
    }

    // Metadata for the last right-clicked video link, keyed by videoId. The browser's
    // `contextmenu` event fires before the background's contextMenus.onClicked, so when
    // the user picks "Add to Cliphy" the background can pull the scraped title/channel/
    // duration from here via GET_QUEUE_METADATA.
    const contextVideoData = new Map<string, ThumbnailData>();

    function rememberContextVideo(target: Element | null) {
      const anchor = target?.closest<HTMLAnchorElement>("a[href*='/watch?v=']");
      if (!anchor?.href) return;

      let videoId: string | null;
      try {
        videoId = new URL(anchor.href).searchParams.get("v");
      } catch {
        return;
      }
      if (!videoId) return;

      // Scrape title/channel/duration from the enclosing video renderer if we can find one.
      const renderer = anchor.closest(VIDEO_RENDERERS);
      const data = renderer ? extractThumbnailData(renderer) : null;
      contextVideoData.set(videoId, data ?? { videoId, url: anchor.href });
    }

    document.addEventListener(
      "contextmenu",
      (e) => rememberContextVideo(e.target as Element | null),
      true,
    );

    // Resolve metadata for a video URL: live page info if it's the current video,
    // otherwise the scraped data from the last right-clicked thumbnail.
    function getQueueMetadata(videoUrl: string): QueueMetadata {
      let videoId: string | null;
      try {
        videoId = new URL(videoUrl).searchParams.get("v");
      } catch {
        return {};
      }
      if (!videoId) return {};

      if (isVideoPage() && new URL(window.location.href).searchParams.get("v") === videoId) {
        const info = getVideoInfo();
        return {
          videoTitle: info.title || undefined,
          videoChannel: info.channel || undefined,
          videoDurationSeconds: info.duration ? parseDurationToSeconds(info.duration) : undefined,
        };
      }

      const data = contextVideoData.get(videoId);
      if (!data) return {};
      return {
        videoTitle: data.title,
        videoChannel: data.channel,
        videoDurationSeconds: data.durationSeconds,
      };
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

        if (msg.type === "GET_QUEUE_METADATA") {
          sendResponse(getQueueMetadata(msg.videoUrl));
          return false;
        }

        if (msg.type === "SEEK_VIDEO") {
          const video = document.querySelector("video");
          if (video) {
            video.currentTime = msg.seconds;
          }
          return false;
        }

        if (msg.type === "SHOW_TOAST") {
          showToast(msg.message, msg.linkLabel, msg.variant);
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
      // Re-inject player overlay on every SPA navigation
      injectVideoOverlay();

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

    // Initial page load — inject player overlay and notify background
    injectVideoOverlay();

    if (isVideoPage()) {
      setTimeout(() => {
        notifyBackground(getVideoInfo());
      }, 1000);
    }
  },
});
