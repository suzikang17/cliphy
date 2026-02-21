# Popup Dashboard & Summary Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build three UI surfaces for the extension — a compact popup for quick-add and queue status, a side panel for reading summaries alongside YouTube, and a full-tab page as the primary summary browser. All styled with Tailwind CSS.

**Architecture:** Popup (360px) is the compact queue manager. Side panel (~400px) displays summaries alongside the video with clickable timestamps. Full tab (`summaries.html`) is the primary experience for browsing all summaries. All three share Tailwind CSS and reusable React components. Data flows through the existing API client and background message passing.

**Tech Stack:** React 19, Tailwind CSS v4, WXT, `@cliphy/shared` types

---

### Task 1: Add Tailwind CSS to the extension

**Files:**

- Create: `apps/extension/assets/main.css`
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/entrypoints/popup/index.html`
- Modify: `apps/extension/entrypoints/popup/main.tsx`

**Step 1: Install Tailwind CSS**

Run:

```bash
cd apps/extension && pnpm add -D tailwindcss @tailwindcss/vite
```

**Step 2: Create `apps/extension/assets/main.css`**

```css
@import "tailwindcss";
```

**Step 3: Add Tailwind Vite plugin to WXT config**

In `apps/extension/wxt.config.ts`, add the Tailwind plugin:

```typescript
import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "Cliphy",
    description: "Queue YouTube videos and get AI-powered summaries",
    version: "0.0.1",
    permissions: ["storage", "activeTab", "tabs", "identity", "contextMenus"],
    host_permissions: ["https://www.youtube.com/*"],
  },
});
```

**Step 4: Import CSS in popup**

In `apps/extension/entrypoints/popup/main.tsx`, add at the top:

```typescript
import "../../assets/main.css";
```

Remove the `<style>` block from `apps/extension/entrypoints/popup/index.html` (Tailwind handles styling now). Keep the body width/height as Tailwind classes in the App component instead.

**Step 5: Build to verify**

Run: `pnpm build:extension`
Expected: PASS, extension builds with Tailwind CSS.

**Step 6: Typecheck**

Run: `pnpm --filter extension typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/extension/
git commit -m "add Tailwind CSS to extension"
```

---

### Task 2: Rewrite popup with Tailwind — auth screens

**Files:**

- Modify: `apps/extension/entrypoints/popup/App.tsx`
- Modify: `apps/extension/entrypoints/popup/index.html`

**Step 1: Update index.html**

Replace the `<style>` block in `apps/extension/entrypoints/popup/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cliphy</title>
  </head>
  <body class="w-[360px] min-h-[400px] m-0 font-sans bg-white text-gray-900">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

**Step 2: Rewrite App.tsx with Tailwind classes**

Replace all inline styles with Tailwind utility classes. Keep the exact same functionality (auth check, sign in, sign out, user display). The component structure stays the same — just swap `style={{...}}` for `className="..."`.

Loading state:

```tsx
if (loading) {
  return (
    <div className="p-4 text-center">
      <p className="text-gray-500 text-sm">Loading...</p>
    </div>
  );
}
```

Sign-in state:

```tsx
if (!user) {
  return (
    <div className="p-4">
      <h1 className="text-xl font-semibold">Cliphy</h1>
      <p className="text-gray-500 text-sm mt-2">
        Queue YouTube videos and get AI-powered summaries.
      </p>
      <button
        onClick={handleSignIn}
        className="mt-4 w-full py-2.5 px-5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
      >
        Sign in with Google
      </button>
      {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
    </div>
  );
}
```

Authenticated state (placeholder — queue list and video card come in later tasks):

```tsx
return (
  <div className="p-4">
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-semibold">Cliphy</h1>
      <button
        onClick={handleSignOut}
        className="py-1.5 px-3 text-xs text-gray-500 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
      >
        Sign out
      </button>
    </div>
    <p className="text-sm text-gray-500 mt-1">{user.email}</p>
    {/* Queue list and video card will be added in subsequent tasks */}
  </div>
);
```

**Step 3: Build to verify**

Run: `pnpm build:extension`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/extension/entrypoints/popup/
git commit -m "rewrite popup auth screens with Tailwind"
```

---

### Task 3: Add current video card to popup

**Files:**

- Create: `apps/extension/components/VideoCard.tsx`
- Modify: `apps/extension/entrypoints/popup/App.tsx`

**Step 1: Create VideoCard component**

Create `apps/extension/components/VideoCard.tsx`:

```tsx
import type { VideoInfo } from "@cliphy/shared";

interface VideoCardProps {
  video: VideoInfo;
  onAdd: () => void;
  isAdding: boolean;
  status: "idle" | "queued" | "processing" | "error";
  error?: string;
}

export function VideoCard({ video, onAdd, isAdding, status, error }: VideoCardProps) {
  const isDisabled = isAdding || status === "queued" || status === "processing";

  return (
    <div className="border border-gray-200 rounded-lg p-3 mt-3">
      <p className="text-sm font-medium truncate">{video.title}</p>
      {video.channel && <p className="text-xs text-gray-500 mt-0.5">{video.channel}</p>}
      <button
        onClick={onAdd}
        disabled={isDisabled}
        className={`mt-2 w-full py-2 text-sm rounded transition-colors ${
          isDisabled
            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {isAdding
          ? "Adding..."
          : status === "queued"
            ? "Queued"
            : status === "processing"
              ? "Processing..."
              : "Add to Queue"}
      </button>
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  );
}
```

**Step 2: Wire into App.tsx**

Add video detection to the authenticated view in `App.tsx`:

- On mount, send `GET_VIDEO_INFO` to the active tab's content script via `browser.tabs.sendMessage`
- If response has a `videoId`, show `<VideoCard>`
- "Add to Queue" sends `ADD_TO_QUEUE` to background, updates status on response

Add these state variables and effects:

```tsx
const [video, setVideo] = useState<VideoInfo | null>(null);
const [addStatus, setAddStatus] = useState<"idle" | "queued" | "processing" | "error">("idle");
const [addError, setAddError] = useState<string | null>(null);
const [isAdding, setIsAdding] = useState(false);

useEffect(() => {
  // Query the active tab's content script for video info
  async function detectVideo() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && tab.url?.includes("youtube.com/watch")) {
        const info = await browser.tabs.sendMessage(tab.id, { type: "GET_VIDEO_INFO" });
        if (info?.videoId) setVideo(info as VideoInfo);
      }
    } catch {
      // Not on a YouTube page or content script not loaded
    }
  }
  if (user) detectVideo();
}, [user]);

async function handleAddToQueue() {
  if (!video?.url) return;
  setIsAdding(true);
  setAddError(null);
  try {
    const response = (await browser.runtime.sendMessage({
      type: "ADD_TO_QUEUE",
      videoUrl: video.url,
    })) as { success: boolean; error?: string };
    if (response?.success) {
      setAddStatus("queued");
    } else {
      setAddStatus("error");
      setAddError(response?.error ?? "Failed to add");
    }
  } catch (err) {
    setAddStatus("error");
    setAddError(err instanceof Error ? err.message : "Failed to add");
  } finally {
    setIsAdding(false);
  }
}
```

Render `<VideoCard>` in the authenticated view, between the header and the queue list placeholder:

```tsx
{
  video && (
    <VideoCard
      video={video}
      onAdd={handleAddToQueue}
      isAdding={isAdding}
      status={addStatus}
      error={addError ?? undefined}
    />
  );
}
```

**Step 3: Build + typecheck**

Run: `pnpm build:extension && pnpm --filter extension typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/extension/components/VideoCard.tsx apps/extension/entrypoints/popup/App.tsx
git commit -m "add current video card to popup with add-to-queue"
```

---

### Task 4: Add queue list and usage bar to popup

**Files:**

- Create: `apps/extension/components/QueueList.tsx`
- Create: `apps/extension/components/UsageBar.tsx`
- Modify: `apps/extension/entrypoints/popup/App.tsx`

**Step 1: Create QueueList component**

Create `apps/extension/components/QueueList.tsx`:

```tsx
import type { Summary } from "@cliphy/shared";

interface QueueListProps {
  summaries: Summary[];
  onViewSummary: (id: string) => void;
}

const STATUS_ICONS: Record<string, string> = {
  completed: "\u2705",
  processing: "\u23f3",
  pending: "\u23f3",
  failed: "\u274c",
};

export function QueueList({ summaries, onViewSummary }: QueueListProps) {
  if (summaries.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-gray-400">No videos queued yet.</p>
        <p className="text-xs text-gray-400 mt-1">Visit a YouTube video and click "Add to Queue"</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {summaries.map((summary) => (
        <button
          key={summary.id}
          onClick={() => summary.status === "completed" && onViewSummary(summary.id)}
          disabled={summary.status !== "completed"}
          className={`w-full text-left py-2.5 px-1 flex items-start gap-2 ${
            summary.status === "completed" ? "hover:bg-gray-50 cursor-pointer" : "cursor-default"
          }`}
        >
          <span className="text-sm shrink-0">{STATUS_ICONS[summary.status]}</span>
          <div className="min-w-0">
            <p className="text-sm truncate">{summary.videoTitle ?? "Untitled Video"}</p>
            {summary.status === "failed" && summary.errorMessage && (
              <p className="text-xs text-red-500 truncate">{summary.errorMessage}</p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Create UsageBar component**

Create `apps/extension/components/UsageBar.tsx`:

```tsx
import type { UsageInfo } from "@cliphy/shared";

interface UsageBarProps {
  usage: UsageInfo;
}

export function UsageBar({ usage }: UsageBarProps) {
  const percent = Math.min((usage.used / usage.limit) * 100, 100);
  const isAtLimit = usage.used >= usage.limit;

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>
          {usage.used}/{usage.limit} summaries today
        </span>
        <span className="capitalize">{usage.plan} plan</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isAtLimit ? "bg-red-500" : "bg-blue-600"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
```

**Step 3: Wire into App.tsx**

Add state and data fetching for queue and usage:

```tsx
const [summaries, setSummaries] = useState<Summary[]>([]);
const [usage, setUsage] = useState<UsageInfo | null>(null);
const [dataLoading, setDataLoading] = useState(true);

useEffect(() => {
  async function fetchData() {
    try {
      const [queueRes, usageRes] = await Promise.all([getQueue(), getUsage()]);
      setSummaries(queueRes.summaries);
      setUsage(usageRes.usage);
    } catch {
      // Silently fail — user sees empty state
    } finally {
      setDataLoading(false);
    }
  }
  if (user) fetchData();
}, [user]);

function handleViewSummary(id: string) {
  // Opens side panel — implemented in Task 6
  const url = browser.runtime.getURL(`/sidepanel.html?id=${id}`);
  browser.tabs.create({ url });
}
```

Add imports at top of App.tsx:

```tsx
import type { Summary, UsageInfo, VideoInfo } from "@cliphy/shared";
import { getQueue, getUsage } from "../../lib/api";
import { VideoCard } from "../../components/VideoCard";
import { QueueList } from "../../components/QueueList";
import { UsageBar } from "../../components/UsageBar";
```

Update the authenticated return:

```tsx
return (
  <div className="p-4">
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-semibold">Cliphy</h1>
      <button
        onClick={handleSignOut}
        className="py-1.5 px-3 text-xs text-gray-500 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
      >
        Sign out
      </button>
    </div>
    <p className="text-sm text-gray-500 mt-1">{user.email}</p>

    {video && (
      <VideoCard
        video={video}
        onAdd={handleAddToQueue}
        isAdding={isAdding}
        status={addStatus}
        error={addError ?? undefined}
      />
    )}

    <div className="mt-3">
      <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Queue</h2>
      {dataLoading ? (
        <p className="text-sm text-gray-400 py-4 text-center">Loading...</p>
      ) : (
        <QueueList summaries={summaries} onViewSummary={handleViewSummary} />
      )}
    </div>

    {usage && <UsageBar usage={usage} />}
  </div>
);
```

**Step 4: Build + typecheck**

Run: `pnpm build:extension && pnpm --filter extension typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/extension/components/ apps/extension/entrypoints/popup/App.tsx
git commit -m "add queue list and usage bar to popup"
```

---

### Task 5: Create side panel entrypoint

**Files:**

- Create: `apps/extension/entrypoints/sidepanel/index.html`
- Create: `apps/extension/entrypoints/sidepanel/main.tsx`
- Create: `apps/extension/entrypoints/sidepanel/App.tsx`
- Modify: `apps/extension/wxt.config.ts` (add `sidePanel` permission)

**Step 1: Add sidePanel permission**

In `apps/extension/wxt.config.ts`, add `"sidePanel"` to permissions:

```typescript
permissions: ["storage", "activeTab", "tabs", "identity", "contextMenus", "sidePanel"],
```

**Step 2: Create side panel HTML**

Create `apps/extension/entrypoints/sidepanel/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cliphy</title>
  </head>
  <body class="m-0 font-sans bg-white text-gray-900">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

**Step 3: Create side panel main.tsx**

Create `apps/extension/entrypoints/sidepanel/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../assets/main.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Step 4: Create side panel App.tsx**

Create `apps/extension/entrypoints/sidepanel/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Summary } from "@cliphy/shared";
import { getSummary, getSummaries } from "../../lib/api";
import { isAuthenticated, getAccessToken } from "../../lib/auth";

export function App() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState<"detail" | "list">("list");

  useEffect(() => {
    async function init() {
      const authenticated = await isAuthenticated();
      setAuthed(authenticated);
      if (!authenticated) {
        setLoading(false);
        return;
      }

      // Check if opened with a specific summary ID
      const params = new URLSearchParams(window.location.search);
      const id = params.get("id");

      if (id) {
        try {
          const res = await getSummary(id);
          setSummary(res.summary);
          setView("detail");
        } catch {
          // Fall through to list view
        }
      }

      try {
        const res = await getSummaries();
        setSummaries(res.summaries.filter((s) => s.status === "completed"));
      } catch {
        // Silently fail
      }

      setLoading(false);
    }
    init();
  }, []);

  function handleTimestampClick(timestamp: string) {
    // Parse "2:30" or "1:02:30" to seconds
    const parts = timestamp.match(/(\d+):(\d+)(?::(\d+))?/);
    if (!parts) return;
    let seconds: number;
    if (parts[3]) {
      seconds = parseInt(parts[1]) * 3600 + parseInt(parts[2]) * 60 + parseInt(parts[3]);
    } else {
      seconds = parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }

    // Send to content script to seek video
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        browser.tabs.sendMessage(tab.id, { type: "SEEK_VIDEO", seconds });
      }
    });
  }

  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="p-4 text-center">
        <h1 className="text-lg font-semibold">Cliphy</h1>
        <p className="text-sm text-gray-500 mt-2">Sign in via the popup to view summaries.</p>
      </div>
    );
  }

  if (view === "detail" && summary?.summaryJson) {
    return (
      <div className="p-4">
        <button
          onClick={() => setView("list")}
          className="text-xs text-blue-600 hover:text-blue-700 mb-3"
        >
          &larr; All summaries
        </button>
        <h1 className="text-base font-semibold">{summary.videoTitle ?? "Untitled Video"}</h1>

        <div className="mt-4">
          <p className="text-sm text-gray-700 leading-relaxed">{summary.summaryJson.summary}</p>
        </div>

        {summary.summaryJson.keyPoints.length > 0 && (
          <div className="mt-4">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Key Points
            </h2>
            <ul className="space-y-1">
              {summary.summaryJson.keyPoints.map((point, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <span className="text-gray-400 shrink-0">&bull;</span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.summaryJson.timestamps.length > 0 && (
          <div className="mt-4">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Timestamps
            </h2>
            <div className="space-y-1">
              {summary.summaryJson.timestamps.map((ts, i) => (
                <button
                  key={i}
                  onClick={() => handleTimestampClick(ts)}
                  className="block text-sm text-blue-600 hover:text-blue-700 hover:underline"
                >
                  {ts}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold">Cliphy Summaries</h1>
      {summaries.length === 0 ? (
        <p className="text-sm text-gray-400 mt-4 text-center">No summaries yet.</p>
      ) : (
        <div className="mt-3 divide-y divide-gray-100">
          {summaries.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSummary(s);
                setView("detail");
              }}
              className="w-full text-left py-2.5 hover:bg-gray-50"
            >
              <p className="text-sm font-medium truncate">{s.videoTitle ?? "Untitled Video"}</p>
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                {s.summaryJson?.summary ?? ""}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 5: Build + typecheck**

Run: `pnpm build:extension && pnpm --filter extension typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/extension/entrypoints/sidepanel/ apps/extension/wxt.config.ts
git commit -m "add side panel entrypoint for reading summaries"
```

---

### Task 6: Add SEEK_VIDEO message to content script

**Files:**

- Modify: `packages/shared/src/messages.ts`
- Modify: `apps/extension/entrypoints/youtube.content.ts`

**Step 1: Add SEEK_VIDEO message type**

In `packages/shared/src/messages.ts`, add:

```typescript
// Side panel → Content script (seek video)
export interface SeekVideoMessage {
  type: "SEEK_VIDEO";
  seconds: number;
}
```

Update the union type:

```typescript
export type ExtensionMessage =
  | VideoDetectedMessage
  | GetVideoInfoMessage
  | AddToQueueMessage
  | SignInMessage
  | SignOutMessage
  | SeekVideoMessage;
```

**Step 2: Handle SEEK_VIDEO in content script**

In `apps/extension/entrypoints/youtube.content.ts`, update the message listener:

```typescript
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as ExtensionMessage;
  if (msg.type === "GET_VIDEO_INFO") {
    sendResponse(getVideoInfo());
  } else if (msg.type === "SEEK_VIDEO") {
    const video = document.querySelector("video");
    if (video) {
      video.currentTime = msg.seconds;
    }
  }
  return true;
});
```

**Step 3: Typecheck all packages**

Run: `pnpm --filter shared typecheck && pnpm --filter extension typecheck && pnpm --filter server typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/shared/src/messages.ts apps/extension/entrypoints/youtube.content.ts
git commit -m "add SEEK_VIDEO message for clickable timestamps in side panel"
```

---

### Task 7: Create full-tab summaries page

**Files:**

- Create: `apps/extension/entrypoints/summaries/index.html`
- Create: `apps/extension/entrypoints/summaries/main.tsx`
- Create: `apps/extension/entrypoints/summaries/App.tsx`

**Step 1: Create summaries page HTML**

Create `apps/extension/entrypoints/summaries/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cliphy — Summaries</title>
  </head>
  <body class="m-0 font-sans bg-gray-50 text-gray-900">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

**Step 2: Create summaries main.tsx**

Create `apps/extension/entrypoints/summaries/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../assets/main.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Step 3: Create summaries App.tsx**

Create `apps/extension/entrypoints/summaries/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Summary, UsageInfo } from "@cliphy/shared";
import { getSummaries, getUsage } from "../../lib/api";
import { isAuthenticated } from "../../lib/auth";
import { UsageBar } from "../../components/UsageBar";

export function App() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [selected, setSelected] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    async function init() {
      const authenticated = await isAuthenticated();
      setAuthed(authenticated);
      if (!authenticated) {
        setLoading(false);
        return;
      }

      try {
        const [sumRes, usageRes] = await Promise.all([getSummaries(), getUsage()]);
        setSummaries(sumRes.summaries);
        setUsage(usageRes.usage);

        // Deep link: #/summary/{id}
        const hash = window.location.hash;
        const match = hash.match(/^#\/summary\/(.+)$/);
        if (match) {
          const target = sumRes.summaries.find((s) => s.id === match[1]);
          if (target) setSelected(target);
        }
      } catch {
        // Silently fail
      }

      setLoading(false);
    }
    init();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Cliphy</h1>
          <p className="text-gray-500 mt-2">Sign in via the extension popup to view summaries.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-semibold">Cliphy</h1>
          {usage && (
            <span className="text-xs text-gray-500">
              {usage.used}/{usage.limit} summaries today
            </span>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {selected ? (
          <div>
            <button
              onClick={() => {
                setSelected(null);
                window.location.hash = "";
              }}
              className="text-sm text-blue-600 hover:text-blue-700 mb-4"
            >
              &larr; All summaries
            </button>
            <h2 className="text-xl font-semibold">{selected.videoTitle ?? "Untitled Video"}</h2>

            {selected.summaryJson && (
              <>
                <p className="mt-4 text-gray-700 leading-relaxed">{selected.summaryJson.summary}</p>

                {selected.summaryJson.keyPoints.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
                      Key Points
                    </h3>
                    <ul className="space-y-2">
                      {selected.summaryJson.keyPoints.map((point, i) => (
                        <li key={i} className="text-gray-700 flex gap-2">
                          <span className="text-gray-400 shrink-0">&bull;</span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selected.summaryJson.timestamps.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
                      Timestamps
                    </h3>
                    <div className="space-y-1">
                      {selected.summaryJson.timestamps.map((ts, i) => (
                        <p key={i} className="text-gray-700 text-sm">
                          {ts}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div>
            {summaries.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400">No summaries yet.</p>
                <p className="text-sm text-gray-400 mt-1">
                  Visit a YouTube video and queue it from the Cliphy popup.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {summaries.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelected(s);
                      window.location.hash = `#/summary/${s.id}`;
                    }}
                    className="w-full text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{s.videoTitle ?? "Untitled Video"}</p>
                        {s.summaryJson && (
                          <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                            {s.summaryJson.summary}
                          </p>
                        )}
                      </div>
                      <span
                        className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${
                          s.status === "completed"
                            ? "bg-green-50 text-green-700"
                            : s.status === "failed"
                              ? "bg-red-50 text-red-700"
                              : "bg-yellow-50 text-yellow-700"
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
```

**Step 4: Build + typecheck**

Run: `pnpm build:extension && pnpm --filter extension typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/extension/entrypoints/summaries/
git commit -m "add full-tab summaries page"
```

---

### Task 8: Wire popup links to side panel and full tab

**Files:**

- Modify: `apps/extension/entrypoints/popup/App.tsx`

**Step 1: Update handleViewSummary to open side panel**

In `apps/extension/entrypoints/popup/App.tsx`, update `handleViewSummary`:

```typescript
async function handleViewSummary(id: string) {
  // Try to open side panel, fall back to new tab
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.sidePanel.open({ tabId: tab.id });
      await browser.sidePanel.setOptions({
        tabId: tab.id,
        path: `/sidepanel.html?id=${id}`,
        enabled: true,
      });
    }
  } catch {
    // Fallback to full tab
    const url = browser.runtime.getURL(`/summaries.html#/summary/${id}`);
    browser.tabs.create({ url });
  }
  window.close(); // Close popup
}
```

**Step 2: Add "View All" link in the footer**

Add a "View All" link above or alongside the UsageBar:

```tsx
<div className="mt-3 pt-3 border-t border-gray-100">
  <button
    onClick={() => {
      const url = browser.runtime.getURL("/summaries.html");
      browser.tabs.create({ url });
      window.close();
    }}
    className="w-full text-center text-xs text-blue-600 hover:text-blue-700 py-1"
  >
    View all summaries &rarr;
  </button>
  {usage && <UsageBar usage={usage} />}
</div>
```

**Step 3: Build + typecheck**

Run: `pnpm build:extension && pnpm --filter extension typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/extension/entrypoints/popup/App.tsx
git commit -m "wire popup links to side panel and full-tab summaries"
```

---

### Task 9: Run full CI and final verification

**Step 1: Run full CI suite**

```bash
pnpm exec prettier --check .
pnpm lint
pnpm --filter shared typecheck
pnpm --filter extension typecheck
pnpm --filter server typecheck
pnpm build:extension
pnpm build:server
pnpm test:unit -- --run
```

Expected: All pass.

**Step 2: Fix any issues**

If prettier or lint fails, fix and re-run.

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix lint and formatting for popup dashboard"
```
