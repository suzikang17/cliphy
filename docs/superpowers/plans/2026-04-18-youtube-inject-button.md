---
title: "YouTube UI Button Injection Implementation Plan"
date: 2026-04-18
---

# YouTube UI Button Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject a "Summarize" ghost button with the Cliphy butterfly icon into YouTube's video page and thumbnail cards, sending videos to the queue via the existing `ADD_TO_QUEUE` background handler.

**Architecture:** All injection logic lives in the existing `youtube.content.ts` content script. Pure utility functions go at module level (outside `main()`) so they're independently testable. A new `OPEN_SIDEPANEL` message type lets the toast's "Open Cliphy →" link open the side panel from the content script.

**Tech Stack:** WXT content script, TypeScript, Vitest (unit tests for pure utils), `browser.runtime.sendMessage`, `MutationObserver`

---

## File Map

| File                                            | Change                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/messages.ts`               | Add `OpenSidePanelMessage` type                                                                                  |
| `apps/extension/wxt.config.ts`                  | Add `web_accessible_resources` so icon-16.png is usable in injected DOM                                          |
| `apps/extension/entrypoints/background.ts`      | Add `OPEN_SIDEPANEL` case to message handler                                                                     |
| `apps/extension/entrypoints/youtube.content.ts` | Add toast, session state, `parseDurationToSeconds`, `injectVideoPageButton`, `injectThumbnailButtons`, wire init |
| `apps/extension/tests/youtube-inject.test.ts`   | Unit tests for `parseDurationToSeconds`                                                                          |

---

## Task 1: Add OPEN_SIDEPANEL message type

**Files:**

- Modify: `packages/shared/src/messages.ts`

- [ ] **Step 1: Add the message interface and union member**

In `packages/shared/src/messages.ts`, add after the `SeekVideoMessage` interface and update the union:

```typescript
// Content script → Background
export interface OpenSidePanelMessage {
  type: "OPEN_SIDEPANEL";
}

export type ExtensionMessage =
  | VideoDetectedMessage
  | GetVideoInfoMessage
  | AddToQueueMessage
  | SignInMessage
  | SignOutMessage
  | SetupRealtimeMessage
  | SummaryUpdatedMessage
  | SeekVideoMessage
  | OpenSidePanelMessage;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/extension && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/messages.ts
git commit -m "add OPEN_SIDEPANEL message type"
```

---

## Task 2: Make butterfly icon web-accessible

**Files:**

- Modify: `apps/extension/wxt.config.ts`

Content scripts can reference extension assets via `browser.runtime.getURL()` only if those assets are declared in `web_accessible_resources`. The `icons/` files are currently only listed under `action.default_icon` — not web-accessible.

- [ ] **Step 1: Add web_accessible_resources to manifest config**

In `apps/extension/wxt.config.ts`, add inside `manifest: { ... }`:

```typescript
web_accessible_resources: [
  {
    resources: ["icons/icon-16.png"],
    matches: ["https://www.youtube.com/*"],
  },
],
```

Full updated manifest block:

```typescript
manifest: {
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAh7dyfIsSttx5YvhSIZa3ip65nvA/Smvr0+ucLxZjKcRwl8qAsc8tObthwSQlj8kKl/VQiVCZiXVHZWxqjIWF7kqycP5knax4ahSk0pQ3XVVJFUWtNxW2QCeYW6/44I6VG5yVa3R2QlgZP6jFRCKkaDhtdMdq3/mOOU2zM0I8zvTVyJbJzlQL8QkFfgui1R5nX1/Sc1SZKtV2e1pvCz4DvV9zFh3ihzev2p0GZLBzVx28AuRpi+WyUgAkmSQ0N0FouwJSTs6w1ykHyw/zzyHdRfhUGAR5ubn3+bRRE3Z2U+C8gHX3OGvLSusYv06L7+/wN6aE3SnFBJXNCNcELx31NQIDAQAB",
  name: "Cliphy",
  description: "Queue YouTube videos and get AI-powered summaries",
  version: "1.0.0",
  permissions: ["storage", "tabs", "identity", "contextMenus", "sidePanel"],
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  action: {
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
  },
  host_permissions: ["https://www.youtube.com/*"],
  web_accessible_resources: [
    {
      resources: ["icons/icon-16.png"],
      matches: ["https://www.youtube.com/*"],
    },
  ],
},
```

- [ ] **Step 2: Build extension to verify config is valid**

```bash
cd apps/extension && pnpm exec wxt build
```

Expected: build succeeds, `.output/chrome-mv3/manifest.json` contains `"web_accessible_resources"`.

Verify:

```bash
grep -A5 "web_accessible_resources" apps/extension/.output/chrome-mv3/manifest.json
```

- [ ] **Step 3: Commit**

```bash
git add apps/extension/wxt.config.ts
git commit -m "make icon-16 web-accessible for content script injection"
```

---

## Task 3: Add OPEN_SIDEPANEL handler to background

**Files:**

- Modify: `apps/extension/entrypoints/background.ts`

- [ ] **Step 1: Add the case to the message switch**

In `background.ts`, first rename the listener parameter `_sender` → `sender` (the underscore signals "unused" by convention; now we need it):

```typescript
// Before:
(message: unknown, _sender: Runtime.MessageSender, sendResponse) => {
// After:
(message: unknown, sender: Runtime.MessageSender, sendResponse) => {
```

Then add after the `SETUP_REALTIME` case and before the final `return false`:

```typescript
case "OPEN_SIDEPANEL": {
  const tabId = sender.tab?.id;
  if (tabId) {
    browser.sidePanel.open({ tabId }).catch(() => {});
  }
  sendResponse({ success: true });
  return false;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/extension && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/entrypoints/background.ts
git commit -m "handle OPEN_SIDEPANEL message in background"
```

---

## Task 4: Write tests for parseDurationToSeconds

**Files:**

- Create: `apps/extension/tests/youtube-inject.test.ts`

This utility converts YouTube thumbnail duration strings ("4:32", "1:23:45") to seconds for the `videoDurationSeconds` API field. Write the tests before the implementation.

- [ ] **Step 1: Create the test file**

```typescript
// apps/extension/tests/youtube-inject.test.ts
import { describe, it, expect } from "vitest";
import { parseDurationToSeconds } from "../entrypoints/youtube.content";

describe("parseDurationToSeconds", () => {
  it("converts MM:SS format", () => {
    expect(parseDurationToSeconds("4:32")).toBe(272);
  });

  it("converts HH:MM:SS format", () => {
    expect(parseDurationToSeconds("1:23:45")).toBe(5025);
  });

  it("handles single-digit minutes", () => {
    expect(parseDurationToSeconds("0:45")).toBe(45);
  });

  it("handles hour-long videos", () => {
    expect(parseDurationToSeconds("1:00:00")).toBe(3600);
  });

  it("returns 0 for empty string", () => {
    expect(parseDurationToSeconds("")).toBe(0);
  });

  it("returns 0 for unrecognized format", () => {
    expect(parseDurationToSeconds("LIVE")).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — expect failure (function not yet exported)**

```bash
pnpm test:unit
```

Expected: FAIL — `parseDurationToSeconds` is not exported from `youtube.content`.

---

## Task 5: Implement parseDurationToSeconds and toast infrastructure

**Files:**

- Modify: `apps/extension/entrypoints/youtube.content.ts`

- [ ] **Step 1: Add module-level export for parseDurationToSeconds**

At the top of `youtube.content.ts`, before `defineContentScript`, add:

```typescript
/** Converts "4:32" or "1:23:45" to total seconds. Returns 0 if unrecognized. */
export function parseDurationToSeconds(duration: string): number {
  const parts = duration.trim().split(":").map(Number);
  if (parts.some(isNaN) || parts.length < 2 || parts.length > 3) return 0;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  const [m, s] = parts;
  return m * 60 + s;
}
```

- [ ] **Step 2: Run tests — expect pass**

```bash
pnpm test:unit
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Add toast + button styles to main()**

Inside the `main()` function, at the very top (before the existing `formatDuration` function), add:

```typescript
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
```

- [ ] **Step 4: Add toast element and show/hide helpers**

After the styles block (still inside `main()`), add:

```typescript
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
```

- [ ] **Step 5: Add session state**

After the toast block, add:

```typescript
// ── Session queue state ──────────────────────────────────────
const queuedVideoIds = new Set<string>();
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd apps/extension && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/entrypoints/youtube.content.ts apps/extension/tests/youtube-inject.test.ts
git commit -m "add parseDurationToSeconds, toast infrastructure, and session state to content script"
```

---

## Task 6: Implement injectVideoPageButton

**Files:**

- Modify: `apps/extension/entrypoints/youtube.content.ts`

- [ ] **Step 1: Add waitForElement helper inside main()**

After the session state block, add:

```typescript
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
```

- [ ] **Step 2: Add injectVideoPageButton inside main()**

After `waitForElement`, add:

```typescript
// ── Video page button ─────────────────────────────────────────
async function injectVideoPageButton() {
  // Remove any previously injected button (SPA navigation)
  document.getElementById("cliphy-video-btn")?.remove();

  if (!isVideoPage()) return;
  const info = getVideoInfo();
  if (!info.videoId || info.isLive) return;

  const actions = await waitForElement("#actions");
  if (!actions) return;

  // Don't double-inject (race condition guard)
  if (document.getElementById("cliphy-video-btn")) return;

  const iconUrl = browser.runtime.getURL("icons/icon-16.png");
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
      upgrade_url?: string;
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

  // Append after the existing action buttons container
  const actionsInner = actions.querySelector("#top-level-buttons-computed") ?? actions;
  actionsInner.appendChild(btn);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/extension && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/entrypoints/youtube.content.ts
git commit -m "add injectVideoPageButton to content script"
```

---

## Task 7: Implement injectThumbnailButtons

**Files:**

- Modify: `apps/extension/entrypoints/youtube.content.ts`

- [ ] **Step 1: Add extractThumbnailData helper inside main()**

After `injectVideoPageButton`, add:

```typescript
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

  let videoId: string | null = null;
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
```

- [ ] **Step 2: Add injectThumbnailButton (single card) inside main()**

After `extractThumbnailData`, add:

```typescript
function injectThumbnailButton(el: Element) {
  if (el.hasAttribute("data-cliphy-injected")) return;
  el.setAttribute("data-cliphy-injected", "1");

  const data = extractThumbnailData(el);
  if (!data) return;

  const iconUrl = browser.runtime.getURL("icons/icon-16.png");
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
    } satisfies ExtensionMessage)) as { success: boolean; error?: string; code?: string };

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

  // Find the metadata container to append below (varies by renderer type)
  const metaContainer =
    el.querySelector("#meta") ??
    el.querySelector("#details") ??
    el.querySelector("#dismissible") ??
    el;
  metaContainer.appendChild(btn);
}
```

- [ ] **Step 3: Add injectThumbnailButtons (observer setup) inside main()**

After `injectThumbnailButton`, add:

```typescript
function injectThumbnailButtons() {
  // Process any renderers already in the DOM
  document.querySelectorAll(THUMBNAIL_RENDERERS).forEach(injectThumbnailButton);

  // Watch for new renderers as user scrolls / navigates
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
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/extension && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/youtube.content.ts
git commit -m "add injectThumbnailButtons with MutationObserver to content script"
```

---

## Task 8: Wire init and SPA navigation

**Files:**

- Modify: `apps/extension/entrypoints/youtube.content.ts`

- [ ] **Step 1: Call injection functions at init and on SPA navigation**

Find the existing `document.addEventListener("yt-navigate-finish", ...)` block in `main()` and update it to also call `injectVideoPageButton()` and `injectThumbnailButtons()`. Replace the entire block:

```typescript
document.addEventListener("yt-navigate-finish", () => {
  // Re-inject video page button on SPA navigation
  injectVideoPageButton();

  if (!isVideoPage()) return;

  const oldTitle = document.title;

  const videoId = new URL(window.location.href).searchParams.get("v");
  notifyBackground({
    videoId,
    title: "",
    url: window.location.href,
    channel: null,
    duration: null,
    isLive: false,
  });

  let attempts = 0;
  const poll = setInterval(() => {
    attempts++;
    if (document.title !== oldTitle || attempts >= 12) {
      clearInterval(poll);
      setTimeout(() => notifyBackground(getVideoInfo()), 500);
    }
  }, 500);
});
```

Then find the existing `if (isVideoPage())` block at the bottom of `main()` and replace it:

```typescript
// Initial page load
injectVideoPageButton();
injectThumbnailButtons();

if (isVideoPage()) {
  setTimeout(() => {
    notifyBackground(getVideoInfo());
  }, 1000);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/extension && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Build extension**

```bash
pnpm build:extension
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Run unit tests**

```bash
pnpm test:unit
```

Expected: all tests pass.

- [ ] **Step 5: Manual smoke test**

Load unpacked extension from `apps/extension/.output/chrome-mv3` in Chrome. Verify:

1. Open `youtube.com/watch?v=dQw4w9WgXcQ` — "Summarize" button appears in the actions row next to Like/Share
2. Click button while signed in → button shows "✓ Added", toast appears with "Open Cliphy →" link
3. Click "Open Cliphy →" in toast → side panel opens
4. Navigate to youtube.com search results → each thumbnail card has a small "Summarize" button below the metadata
5. Click a thumbnail "Summarize" button → toast appears, video added to queue
6. Navigate back to the video → button shows "✓ Added" (session state preserved)
7. Open a livestream → no button appears on the video page

- [ ] **Step 6: Commit**

```bash
git add apps/extension/entrypoints/youtube.content.ts
git commit -m "wire YouTube button injection into init and SPA navigation"
```
