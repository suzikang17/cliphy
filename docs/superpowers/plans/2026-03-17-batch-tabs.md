# Batch Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Pro users queue all open YouTube tabs at once from a button in the sidepanel header.

**Architecture:** New `BatchTabsButton` component in the top bar handles tab discovery, dropdown UI, and batch submission. Uses existing `addToQueueBatch()` API client and `GET_VIDEO_INFO` content script message. No server changes.

**Tech Stack:** React, WXT browser APIs, existing shared types

**Spec:** `docs/superpowers/specs/2026-03-17-batch-tabs-design.md`

---

## File Structure

| File                                                           | Action | Responsibility                                                         |
| -------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `apps/extension/components/BatchTabsButton.tsx`                | Create | Button + dropdown UI, tab discovery, selection state, batch submission |
| `apps/extension/entrypoints/sidepanel/App.tsx`                 | Modify | Add `BatchTabsButton` to top bar                                       |
| `apps/extension/components/__tests__/BatchTabsButton.test.tsx` | Create | Unit tests                                                             |

---

### Task 1: Create BatchTabsButton component with tab discovery

**Files:**

- Create: `apps/extension/components/__tests__/BatchTabsButton.test.tsx`
- Create: `apps/extension/components/BatchTabsButton.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// apps/extension/components/__tests__/BatchTabsButton.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BatchTabsButton } from "../BatchTabsButton";

// Mock browser API
const mockTabsQuery = vi.fn();
const mockTabsSendMessage = vi.fn();

vi.mock("wxt/browser", () => ({
  browser: {
    tabs: {
      query: (...args: unknown[]) => mockTabsQuery(...args),
      sendMessage: (...args: unknown[]) => mockTabsSendMessage(...args),
    },
  },
}));

const baseSummaries = [
  { id: "1", videoId: "existing1", status: "completed" },
  { id: "2", videoId: "existing2", status: "pending" },
];

const makeTabs = (ids: number[]) =>
  ids.map((id) => ({
    id,
    url: `https://www.youtube.com/watch?v=video${id}`,
  }));

const makeVideoInfo = (id: number) => ({
  videoId: `video${id}`,
  title: `Video ${id}`,
  url: `https://www.youtube.com/watch?v=video${id}`,
  channel: `Channel ${id}`,
  duration: "10:00",
  isLive: false,
});

describe("BatchTabsButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when no queueable tabs exist", async () => {
    mockTabsQuery.mockResolvedValue([]);
    const { container } = render(
      <BatchTabsButton
        summaries={baseSummaries as any}
        currentVideoId={null}
        onBatchQueue={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders nothing when all tabs are already in queue", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10]));
    mockTabsSendMessage.mockResolvedValue({
      videoId: "existing1",
      title: "Existing",
      url: "https://www.youtube.com/watch?v=existing1",
      channel: "Ch",
      duration: "5:00",
      isLive: false,
    });
    const { container } = render(
      <BatchTabsButton
        summaries={baseSummaries as any}
        currentVideoId={null}
        onBatchQueue={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders button when queueable tabs exist", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10, 20]));
    mockTabsSendMessage.mockImplementation((_tabId: number) =>
      Promise.resolve(makeVideoInfo(_tabId)),
    );
    render(
      <BatchTabsButton
        summaries={baseSummaries as any}
        currentVideoId={null}
        onBatchQueue={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/All tabs/)).toBeTruthy();
    });
  });

  it("filters out live streams", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10]));
    mockTabsSendMessage.mockResolvedValue({
      ...makeVideoInfo(10),
      isLive: true,
    });
    const { container } = render(
      <BatchTabsButton
        summaries={baseSummaries as any}
        currentVideoId={null}
        onBatchQueue={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("filters out current active tab video", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10]));
    mockTabsSendMessage.mockResolvedValue(makeVideoInfo(10));
    const { container } = render(
      <BatchTabsButton
        summaries={baseSummaries as any}
        currentVideoId="video10"
        onBatchQueue={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("skips tabs where content script is not available", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10, 20]));
    mockTabsSendMessage
      .mockRejectedValueOnce(new Error("Could not establish connection"))
      .mockResolvedValueOnce(makeVideoInfo(20));
    render(
      <BatchTabsButton
        summaries={baseSummaries as any}
        currentVideoId={null}
        onBatchQueue={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/All tabs/)).toBeTruthy();
    });
  });

  it("opens dropdown on click and shows discovered tabs", async () => {
    mockTabsQuery.mockResolvedValue(makeTabs([10, 20]));
    mockTabsSendMessage.mockImplementation((_tabId: number) =>
      Promise.resolve(makeVideoInfo(_tabId)),
    );
    render(
      <BatchTabsButton
        summaries={baseSummaries as any}
        currentVideoId={null}
        onBatchQueue={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/All tabs/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/All tabs/));
    await waitFor(() => {
      expect(screen.getByText("Video 10")).toBeTruthy();
      expect(screen.getByText("Video 20")).toBeTruthy();
    });
  });

  it("calls onBatchQueue with selected video URLs on confirm", async () => {
    const onBatchQueue = vi.fn().mockResolvedValue({ added: 2, skipped: 0 });
    mockTabsQuery.mockResolvedValue(makeTabs([10, 20]));
    mockTabsSendMessage.mockImplementation((_tabId: number) =>
      Promise.resolve(makeVideoInfo(_tabId)),
    );
    render(
      <BatchTabsButton
        summaries={baseSummaries as any}
        currentVideoId={null}
        onBatchQueue={onBatchQueue}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/All tabs/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/All tabs/));
    await waitFor(() => {
      expect(screen.getByText(/Queue 2 videos/)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(/Queue 2 videos/));
    await waitFor(() => {
      expect(onBatchQueue).toHaveBeenCalledWith([
        { videoUrl: "https://www.youtube.com/watch?v=video10" },
        { videoUrl: "https://www.youtube.com/watch?v=video20" },
      ]);
    });
  });

  it("allows failed summaries to be re-queued", async () => {
    const summariesWithFailed = [
      ...baseSummaries,
      { id: "3", videoId: "video10", status: "failed" },
    ];
    mockTabsQuery.mockResolvedValue(makeTabs([10]));
    mockTabsSendMessage.mockResolvedValue(makeVideoInfo(10));
    render(
      <BatchTabsButton
        summaries={summariesWithFailed as any}
        currentVideoId={null}
        onBatchQueue={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/All tabs/)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Create the component**

```tsx
// apps/extension/components/BatchTabsButton.tsx
import type { Summary, VideoInfo } from "@cliphy/shared";
import { useEffect, useRef, useState } from "react";

interface DiscoveredTab {
  videoId: string;
  title: string;
  url: string;
  channel: string | null;
  duration: string | null;
}

interface BatchTabsButtonProps {
  summaries: Summary[];
  currentVideoId: string | null;
  onBatchQueue: (
    videos: Array<{ videoUrl: string }>,
  ) => Promise<{ added: number; skipped: number }>;
}

export function BatchTabsButton({ summaries, currentVideoId, onBatchQueue }: BatchTabsButtonProps) {
  const [tabs, setTabs] = useState<DiscoveredTab[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Discover YouTube tabs
  useEffect(() => {
    discoverTabs();
  }, [summaries, currentVideoId]);

  async function discoverTabs() {
    try {
      const ytTabs = await browser.tabs.query({ url: "*://www.youtube.com/watch*" });

      // Get video info from each tab's content script
      const results = await Promise.allSettled(
        ytTabs
          .filter((t) => t.id != null)
          .map(async (tab) => {
            const info = (await browser.tabs.sendMessage(tab.id!, {
              type: "GET_VIDEO_INFO",
            })) as VideoInfo;
            return info;
          }),
      );

      // Collect successful responses, filter out live streams and nulls
      const videos: DiscoveredTab[] = [];
      for (const r of results) {
        if (r.status !== "fulfilled" || !r.value?.videoId) continue;
        const v = r.value;
        if (v.isLive) continue;
        videos.push({
          videoId: v.videoId,
          title: v.title,
          url: v.url,
          channel: v.channel,
          duration: v.duration,
        });
      }

      // Filter out videos already in queue (exclude failed — they can be re-queued)
      const queuedIds = new Set(
        summaries.filter((s) => s.status !== "failed").map((s) => s.videoId),
      );

      // Filter out current active tab video
      const filtered = videos.filter(
        (v) => !queuedIds.has(v.videoId) && v.videoId !== currentVideoId,
      );

      // Deduplicate by videoId (same video in multiple tabs)
      const unique = [...new Map(filtered.map((v) => [v.videoId, v])).values()];

      setTabs(unique);
      setSelected(new Set(unique.map((v) => v.videoId)));
    } catch {
      setTabs([]);
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Hide if no queueable tabs
  if (tabs.length === 0) return null;

  const selectedCount = selected.size;

  function toggleTab(videoId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }

  function toggleAll() {
    if (selectedCount === tabs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tabs.map((t) => t.videoId)));
    }
  }

  async function handleQueue() {
    const videos = tabs.filter((t) => selected.has(t.videoId)).map((t) => ({ videoUrl: t.url }));
    if (videos.length === 0) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await onBatchQueue(videos);
      setResult(
        res.skipped > 0
          ? `Queued ${res.added} of ${res.added + res.skipped} videos`
          : `Queued ${res.added} videos`,
      );
      setTimeout(() => {
        setOpen(false);
        setResult(null);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue videos");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
          setResult(null);
        }}
        className="text-[10px] font-bold bg-neon-100/50 dark:bg-neon-900/30 text-neon-700 dark:text-neon-400 border-2 border-(--color-border-hard) rounded-lg px-2 py-1 shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all"
      >
        ⚡ All tabs
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-(--color-surface) border-2 border-neon-500 rounded-lg shadow-brutal-sm z-30 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-(--color-border-soft)">
            <span className="text-[11px] font-bold text-(--color-text)">
              {tabs.length} YouTube tab{tabs.length !== 1 ? "s" : ""} found
            </span>
            <button
              onClick={toggleAll}
              className="text-[10px] font-bold text-neon-600 dark:text-neon-400 bg-transparent border-0 cursor-pointer hover:underline"
            >
              {selectedCount === tabs.length ? "Deselect all" : "Select all"}
            </button>
          </div>

          {/* Tab list */}
          <div className="max-h-48 overflow-y-auto">
            {tabs.map((tab) => (
              <label
                key={tab.videoId}
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-(--color-surface-raised) transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.has(tab.videoId)}
                  onChange={() => toggleTab(tab.videoId)}
                  className="accent-neon-600 shrink-0"
                />
                <img
                  src={`https://i.ytimg.com/vi/${tab.videoId}/default.jpg`}
                  alt=""
                  className="w-12 h-[27px] rounded object-cover shrink-0 border border-(--color-border-muted)"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold leading-snug line-clamp-1 text-(--color-text)">
                    {tab.title}
                  </p>
                  <p className="text-[9px] text-(--color-text-faint) truncate">
                    {[tab.channel, tab.duration].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </label>
            ))}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-(--color-border-soft)">
            {error && <p className="text-[10px] text-red-500 mb-1.5">{error}</p>}
            {result ? (
              <p className="text-[11px] font-bold text-neon-600 dark:text-neon-400 text-center">
                {result}
              </p>
            ) : (
              <button
                onClick={handleQueue}
                disabled={selectedCount === 0 || submitting}
                className="w-full text-[11px] font-bold py-1.5 bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting
                  ? "Queueing..."
                  : `Queue ${selectedCount} video${selectedCount !== 1 ? "s" : ""}`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm test:unit -- --run apps/extension/components/__tests__/BatchTabsButton.test.tsx`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/extension/components/BatchTabsButton.tsx apps/extension/components/__tests__/BatchTabsButton.test.tsx
git commit -m "add BatchTabsButton component with tab discovery and dropdown"
```

---

### Task 2: Wire BatchTabsButton into the sidepanel top bar

**Files:**

- Modify: `apps/extension/entrypoints/sidepanel/App.tsx:498-558` (topBar JSX)

- [ ] **Step 1: Import and add to top bar**

In `App.tsx`, add the import at the top:

```tsx
import { BatchTabsButton } from "../../components/BatchTabsButton";
```

In the `topBar` JSX (line ~498), add `BatchTabsButton` between the title/back button and the user menu. Only render it on the dashboard view for Pro users:

```tsx
const topBar = (
  <div className="sticky top-0 z-10 bg-(--color-surface) border-b border-(--color-border-soft) px-4 py-2 shrink-0 flex items-center justify-between">
    <div className="flex items-center gap-2">
      {view === "detail" ? (
        <>
          <button
            onClick={handleBack}
            className="text-xs font-bold text-(--color-text) bg-(--color-surface) dark:bg-(--color-surface) px-2.5 py-1 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed hover:bg-neon-100 hover:text-neon-600 dark:hover:bg-neon-900/30 dark:hover:text-neon-300 press-down cursor-pointer transition-all"
          >
            &larr; Back
          </button>
        </>
      ) : (
        <span className="text-lg font-extrabold text-(--color-text)">Queue</span>
      )}
    </div>
    <div className="flex items-center gap-2">
      {view === "dashboard" && user?.plan === "pro" && (
        <BatchTabsButton
          summaries={summaries}
          currentVideoId={currentVideo?.videoId ?? null}
          onBatchQueue={async (videos) => {
            const res = await addToQueueBatch(videos);
            await fetchQueueAndUsage();
            return { added: res.added, skipped: res.skipped };
          }}
        />
      )}
      {user && (
        <div className="relative" ref={userMenuRef}>
          {/* ... existing user menu ... */}
        </div>
      )}
    </div>
  </div>
);
```

Note: The right side of the top bar needs to be wrapped in a flex container to hold both the batch button and the user menu. The existing `{user && ...}` block stays as-is, just wrapped.

- [ ] **Step 2: Add the `addToQueueBatch` import**

Add to the existing import from `../../lib/api`:

```tsx
import {
  // ... existing imports ...
  addToQueueBatch,
} from "../../lib/api";
```

- [ ] **Step 3: Verify the build**

Run: `pnpm dev:extension`

Load the extension in Chrome, open 2-3 YouTube tabs, open the sidepanel. Verify:

- Button appears in top bar (Pro account only)
- Clicking opens dropdown with discovered tabs
- Selecting and confirming queues the videos
- Button disappears after all tabs are queued

- [ ] **Step 4: Run all tests**

Run: `pnpm test:unit -- --run`
Expected: All tests pass (including new BatchTabsButton tests)

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/sidepanel/App.tsx
git commit -m "wire BatchTabsButton into sidepanel top bar for Pro users"
```
