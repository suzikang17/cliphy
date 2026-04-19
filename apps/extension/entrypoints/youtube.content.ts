import type { ExtensionMessage, VideoInfo } from "@cliphy/shared";
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

      .cliphy-thumb-overlay {
        position: absolute;
        bottom: 28px;
        right: 4px;
        z-index: 10;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: rgba(0,0,0,0.75);
        border: none;
        border-radius: 50%;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s;
        padding: 0;
      }
      .cliphy-thumb-overlay img { width: 14px; height: 14px; display: block; }
      .cliphy-thumb-overlay { transition: background 0.15s, transform 0.15s; }
      .cliphy-thumb-overlay:hover { background: rgba(255,255,255,0.92); transform: scale(1.15); }
      .cliphy-thumb-overlay:hover img { filter: invert(1); }
      .cliphy-thumb-overlay:disabled { opacity: 0.5 !important; cursor: default; }
      .cliphy-thumb-overlay--visible { opacity: 1; }
      .cliphy-thumb-overlay--added { opacity: 1 !important; background: rgba(62,166,255,0.85); }

      /* Compact thumbnail (sidebar) needs overflow visible so our overlay shows */
      ytd-compact-thumbnail { overflow: visible !important; }
      yt-thumbnail-view-model { overflow: visible !important; }
      yt-lockup-view-model { overflow: visible !important; }

      /* Lockup variant: injected into lockup itself, positioned over thumbnail (left side) */
      .cliphy-thumb-overlay--lockup { top: 6px; left: 6px; right: auto; }

      /* CSS hover for yt-lockup-view-model (sidebar) */
      yt-lockup-view-model:hover .cliphy-thumb-overlay--lockup { opacity: 1; }


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
      safeSendMessage({ type: "OPEN_SIDEPANEL" } satisfies ExtensionMessage);
    });

    function showToast(message: string, linkLabel?: string) {
      if (toastTimer) clearTimeout(toastTimer);
      toastMsg.textContent = message;
      if (linkLabel) {
        toastLink.textContent = linkLabel;
        toastLink.style.display = "inline";
      } else {
        toastLink.style.display = "none";
      }
      toast.classList.add("cliphy-toast--visible");
      toastTimer = setTimeout(() => {
        toast.classList.remove("cliphy-toast--visible");
        toastTimer = null;
      }, 3000);
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
        showToast("Monthly limit reached — upgrade to Pro", "Open Cliphy →");
      } else if (response.code === "pro_required") {
        showToast("Pro plan required", "Upgrade →");
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

    // ── Video page button ─────────────────────────────────────────
    let videoPageBtnGuard: MutationObserver | null = null;

    async function injectVideoPageButton() {
      videoPageBtnGuard?.disconnect();
      videoPageBtnGuard = null;
      document.getElementById("cliphy-video-btn")?.remove();

      if (!isVideoPage()) return;
      const info = getVideoInfo();
      if (!info.videoId || info.isLive) return;

      // Wait for the actions buttons container to be populated, not just #actions existing
      const actionsInnerEl = await waitForElement("#top-level-buttons-computed");
      if (!actionsInnerEl) return;

      if (document.getElementById("cliphy-video-btn")) return;

      const iconUrl = browser.runtime.getURL("/icons/icon-128.png");
      const btn = document.createElement("button");
      btn.id = "cliphy-video-btn";
      btn.className =
        "cliphy-btn yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m";
      btn.style.marginLeft = "8px";

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

      actionsInnerEl.appendChild(btn);

      // YouTube rebuilds #top-level-buttons-computed on SPA navigation after we inject.
      // Watch for our button being removed and re-inject once so it survives the re-render.
      // Scope to the actions bar's parent — not document.body — to avoid firing on every DOM mutation.
      const guardTarget = actionsInnerEl.parentElement ?? actionsInnerEl;
      videoPageBtnGuard = new MutationObserver(() => {
        if (!document.getElementById("cliphy-video-btn") && isVideoPage()) {
          videoPageBtnGuard?.disconnect();
          videoPageBtnGuard = null;
          injectVideoPageButton();
        }
      });
      videoPageBtnGuard.observe(guardTarget, { childList: true, subtree: true });
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
            const actionsBtn = document.getElementById("cliphy-video-btn");
            if (actionsBtn) {
              actionsBtn.innerHTML = `✓ Added`;
              (actionsBtn as HTMLButtonElement).disabled = true;
            }
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

    // ── Thumbnail injection ───────────────────────────────────────
    const THUMBNAIL_RENDERERS =
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

    function injectThumbnailButton(el: Element) {
      if (el.hasAttribute("data-cliphy-injected")) return;

      const data = extractThumbnailData(el);
      if (!data) return; // not hydrated yet — MutationObserver or next scan will retry

      // For yt-lockup-view-model (sidebar), YouTube re-renders yt-thumbnail-view-model
      // on hover, ejecting any children we appended. Inject into the lockup itself instead.
      const isLockup = el.tagName.toLowerCase() === "yt-lockup-view-model";
      let container: HTMLElement;
      if (isLockup) {
        container = el as HTMLElement;
      } else {
        const thumbEl =
          el.querySelector<HTMLElement>("ytd-thumbnail") ??
          el.querySelector<HTMLElement>("ytd-compact-thumbnail") ??
          el.querySelector<HTMLElement>("a#thumbnail");
        if (!thumbEl) return; // not ready yet — MutationObserver will retry
        thumbEl.style.position = "relative";
        thumbEl.style.overflow = "visible";
        container = thumbEl;
      }

      el.setAttribute("data-cliphy-injected", "1");
      (el as HTMLElement).style.position = "relative";
      (el as HTMLElement).style.overflow = "visible";

      const iconUrl = browser.runtime.getURL("/icons/icon-128.png");
      const btn = document.createElement("button");
      btn.className = isLockup
        ? "cliphy-thumb-overlay cliphy-thumb-overlay--lockup"
        : "cliphy-thumb-overlay";

      const alreadyQueued = queuedVideoIds.has(data.videoId);
      btn.innerHTML = `<img src="${iconUrl}" alt="Add to Cliphy" />`;
      if (alreadyQueued) btn.classList.add("cliphy-thumb-overlay--added");
      btn.disabled = alreadyQueued;
      btn.title = alreadyQueued ? "Already in queue" : "Add to Cliphy";

      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.disabled = true;

        const response = (await safeSendMessage({
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

        handleQueueResponse(
          response as QueueResponse,
          () => {
            queuedVideoIds.add(data.videoId);
            btn.classList.add("cliphy-thumb-overlay--added");
            btn.title = "Already in queue";
            showToast("Added to queue", "Open Cliphy →");
          },
          () => {
            btn.disabled = false;
          },
        );
      });

      container.appendChild(btn);

      // JS hover for non-lockup renderers; lockup uses CSS :hover (more reliable)
      if (!isLockup) {
        el.addEventListener("mouseenter", () => btn.classList.add("cliphy-thumb-overlay--visible"));
        el.addEventListener("mouseleave", () => {
          if (!btn.classList.contains("cliphy-thumb-overlay--added")) {
            btn.classList.remove("cliphy-thumb-overlay--visible");
          }
        });
      }
    }

    function injectThumbnailButtons() {
      document.querySelectorAll(THUMBNAIL_RENDERERS).forEach(injectThumbnailButton);

      // Single observer for both thumbnail buttons and menu injection.
      // Skip querySelectorAll on leaf nodes to avoid thrashing during video playback.
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;

            // Thumbnail buttons
            if (node.matches(THUMBNAIL_RENDERERS)) {
              injectThumbnailButton(node);
            } else if (node.firstElementChild) {
              node.querySelectorAll(THUMBNAIL_RENDERERS).forEach(injectThumbnailButton);
            }
            // Catch hydration: a child was added inside an already-present but un-injected renderer
            const parentRenderer = node.parentElement?.closest(THUMBNAIL_RENDERERS);
            if (parentRenderer && !parentRenderer.hasAttribute("data-cliphy-injected")) {
              injectThumbnailButton(parentRenderer);
            }
          }
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
    function scanThumbnails() {
      document.querySelectorAll(THUMBNAIL_RENDERERS).forEach(injectThumbnailButton);
    }

    document.addEventListener("yt-navigate-finish", () => {
      // Re-inject video page button on every SPA navigation
      injectVideoPageButton();
      injectVideoOverlay();
      // Re-scan thumbnails — sidebar loads after navigation completes
      scanThumbnails();

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
    injectVideoOverlay();
    injectThumbnailButtons();
    // Deferred scan in case content script runs before YouTube renders thumbnails
    setTimeout(scanThumbnails, 1500);

    if (isVideoPage()) {
      setTimeout(() => {
        notifyBackground(getVideoInfo());
      }, 1000);
    }
  },
});
