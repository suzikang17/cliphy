import type { ExtensionMessage, VideoInfo } from "@cliphy/shared";
import type { Runtime } from "wxt/browser";
import { parseDurationToSeconds } from "../lib/duration";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],

  main() {
    // ── Injected styles ───────────────────────────────────────────
    const style = document.createElement("style");
    style.textContent = `
      .cliphy-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: rgba(255,255,255,0.1);
        color: #fff;
        border: none;
        border-radius: 18px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        font-family: "Roboto", Arial, sans-serif;
        line-height: 1;
        white-space: nowrap;
        vertical-align: middle;
        transition: background 0.15s;
      }
      .cliphy-btn:hover { background: rgba(255,255,255,0.2); }
      .cliphy-btn:disabled { opacity: 0.7; cursor: default; }
      .cliphy-btn img { width: 14px; height: 14px; display: block; }

      .cliphy-btn--sm {
        padding: 3px 8px;
        font-size: 11px;
        gap: 4px;
      }
      .cliphy-btn--sm img { width: 12px; height: 12px; }

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
      #cliphy-toast a {
        color: #3ea6ff;
        text-decoration: none;
        font-weight: 500;
        white-space: nowrap;
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
      browser.runtime
        .sendMessage({ type: "OPEN_SIDEPANEL" } satisfies ExtensionMessage)
        .catch(() => {});
    });

    function showToast(message: string, withLink = false) {
      if (toastTimer) clearTimeout(toastTimer);
      toastMsg.textContent = message;
      toastLink.style.display = withLink ? "inline" : "none";
      toast.classList.add("cliphy-toast--visible");
      toastTimer = setTimeout(() => {
        toast.classList.remove("cliphy-toast--visible");
        toastTimer = null;
      }, 3000);
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

    function notifyBackground(video: VideoInfo) {
      browser.runtime.sendMessage({
        type: "VIDEO_DETECTED",
        video,
      } satisfies ExtensionMessage);
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

    // ── Video page button ─────────────────────────────────────────
    async function injectVideoPageButton() {
      document.getElementById("cliphy-video-btn")?.remove();

      if (!isVideoPage()) return;
      const info = getVideoInfo();
      if (!info.videoId || info.isLive) return;

      const actions = await waitForElement("#actions");
      if (!actions) return;

      if (document.getElementById("cliphy-video-btn")) return;

      const iconUrl = browser.runtime.getURL("/icons/icon-16.png");
      const btn = document.createElement("button");
      btn.id = "cliphy-video-btn";
      btn.className = "cliphy-btn";
      btn.style.marginLeft = "8px";

      const alreadyQueued = queuedVideoIds.has(info.videoId);
      btn.innerHTML = alreadyQueued ? `✓ Added` : `<img src="${iconUrl}" alt="" /> Summarize`;
      btn.disabled = alreadyQueued;

      btn.addEventListener("click", async () => {
        const currentInfo = getVideoInfo();
        if (!currentInfo.videoId) return;

        btn.disabled = true;
        btn.textContent = "Adding…";

        const durationSeconds = currentInfo.duration
          ? parseDurationToSeconds(currentInfo.duration)
          : undefined;

        const response = (await browser.runtime.sendMessage({
          type: "ADD_TO_QUEUE",
          videoUrl: currentInfo.url,
          videoTitle: currentInfo.title || undefined,
          videoChannel: currentInfo.channel || undefined,
          videoDurationSeconds: durationSeconds || undefined,
        } satisfies ExtensionMessage)) as {
          success: boolean;
          error?: string;
          code?: string;
        };

        if (response.success) {
          queuedVideoIds.add(currentInfo.videoId);
          btn.innerHTML = `✓ Added`;
          showToast("Added to queue", true);
        } else {
          btn.innerHTML = `<img src="${iconUrl}" alt="" /> Summarize`;
          btn.disabled = false;
          if (response.code === "rate_limited") {
            showToast("Monthly limit reached — upgrade to Pro");
          } else if (response.code === "pro_required") {
            showToast("Pro plan required");
          } else if (response.error === "Not authenticated") {
            showToast("Sign in to Cliphy to summarize videos");
          } else {
            showToast("Something went wrong — try again");
          }
        }
      });

      const actionsInner = actions.querySelector("#top-level-buttons-computed") ?? actions;
      actionsInner.appendChild(btn);
    }

    // ── Thumbnail injection ───────────────────────────────────────
    const THUMBNAIL_RENDERERS =
      "ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-rich-grid-media";

    interface ThumbnailData {
      videoId: string;
      title?: string;
      channel?: string;
      durationSeconds?: number;
      url: string;
    }

    function extractThumbnailData(el: Element): ThumbnailData | null {
      const anchor = el.querySelector<HTMLAnchorElement>("a#thumbnail");
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
        el.querySelector<HTMLElement>("#video-title");
      const channelEl =
        el.querySelector<HTMLElement>("ytd-channel-name a") ??
        el.querySelector<HTMLElement>(".ytd-channel-name");
      const durationEl = el.querySelector<HTMLElement>(
        ".ytd-thumbnail-overlay-time-status-renderer span, #text.ytd-thumbnail-overlay-time-status-renderer",
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

    function injectThumbnailButton(el: Element) {
      if (el.hasAttribute("data-cliphy-injected")) return;
      el.setAttribute("data-cliphy-injected", "1");

      const data = extractThumbnailData(el);
      if (!data) return;

      const iconUrl = browser.runtime.getURL("/icons/icon-16.png");
      const btn = document.createElement("button");
      btn.className = "cliphy-btn cliphy-btn--sm";
      btn.style.marginTop = "4px";

      const alreadyQueued = queuedVideoIds.has(data.videoId);
      btn.innerHTML = alreadyQueued ? `✓ Added` : `<img src="${iconUrl}" alt="" /> Summarize`;
      btn.disabled = alreadyQueued;

      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.disabled = true;
        btn.textContent = "Adding…";

        const response = (await browser.runtime.sendMessage({
          type: "ADD_TO_QUEUE",
          videoUrl: data.url,
          videoTitle: data.title,
          videoChannel: data.channel,
          videoDurationSeconds: data.durationSeconds,
        } satisfies ExtensionMessage)) as {
          success: boolean;
          error?: string;
          code?: string;
        };

        if (response.success) {
          queuedVideoIds.add(data.videoId);
          btn.innerHTML = `✓ Added`;
          showToast("Added to queue", true);
        } else {
          btn.innerHTML = `<img src="${iconUrl}" alt="" /> Summarize`;
          btn.disabled = false;
          if (response.code === "rate_limited") {
            showToast("Monthly limit reached — upgrade to Pro");
          } else if (response.code === "pro_required") {
            showToast("Pro plan required");
          } else if (response.error === "Not authenticated") {
            showToast("Sign in to Cliphy to summarize videos");
          } else {
            showToast("Something went wrong — try again");
          }
        }
      });

      const metaContainer =
        el.querySelector("#meta") ??
        el.querySelector("#details") ??
        el.querySelector("#dismissible") ??
        el;
      metaContainer.appendChild(btn);
    }

    function injectThumbnailButtons() {
      document.querySelectorAll(THUMBNAIL_RENDERERS).forEach(injectThumbnailButton);

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            if (node.matches(THUMBNAIL_RENDERERS)) {
              injectThumbnailButton(node);
            }
            node.querySelectorAll(THUMBNAIL_RENDERERS).forEach(injectThumbnailButton);
          });
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
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
      // Re-inject video page button on every SPA navigation
      injectVideoPageButton();

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

    // Initial page load — inject buttons and notify background
    injectVideoPageButton();
    injectThumbnailButtons();

    if (isVideoPage()) {
      setTimeout(() => {
        notifyBackground(getVideoInfo());
      }, 1000);
    }
  },
});
