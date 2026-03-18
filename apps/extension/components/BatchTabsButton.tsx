import type { Summary, VideoInfo } from "@cliphy/shared";
import type { Tabs } from "wxt/browser";
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
          .filter((t: Tabs.Tab) => t.id != null)
          .map(async (tab: Tabs.Tab) => {
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

  // Close dropdown on outside click or Escape
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
        discoverTabs();
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
