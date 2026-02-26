import type { ExtensionMessage, Summary, UsageInfo, VideoInfo } from "@cliphy/shared";
import { parseDurationToSeconds } from "@cliphy/shared";
import { useEffect, useState } from "react";
import { QueueList } from "../../components/QueueList";
import { SummaryDetail } from "../../components/SummaryDetail";
import { UsageBar } from "../../components/UsageBar";
import { VideoCard } from "../../components/VideoCard";
import { deleteQueueItem, getQueue, getSummary, getUsage, retryQueueItem } from "../../lib/api";
import { getAccessToken, isAuthenticated } from "../../lib/auth";

type View = "dashboard" | "detail";

async function seekVideo(seconds: number) {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, { type: "SEEK_VIDEO", seconds });
    }
  } catch {
    // Content script not available
  }
}

interface UserInfo {
  email: string;
  plan: string;
}

export function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<Summary | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addStatus, setAddStatus] = useState<"idle" | "queued" | "processing" | "error">("idle");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    init();
  }, []);

  // Listen for real-time summary updates from background script
  useEffect(() => {
    const listener = (message: unknown) => {
      const msg = message as ExtensionMessage;
      if (msg.type !== "SUMMARY_UPDATED") return;

      const updated = msg.summary;
      setSummaries((prev) => {
        const idx = prev.findIndex((s) => s.id === updated.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [updated, ...prev];
      });

      if (updated.status === "completed" || updated.status === "failed") {
        getUsage()
          .then((res) => setUsage(res.usage))
          .catch(() => {});
      }
    };

    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  // Re-detect video when the active tab navigates
  useEffect(() => {
    const onUpdated = (_tabId: number, changeInfo: { url?: string }) => {
      if (changeInfo.url) {
        detectVideo();
      }
    };
    const onActivated = () => {
      detectVideo();
    };

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onActivated.addListener(onActivated);
    return () => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  // Keyboard shortcut: "a" to add current video to queue
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "a" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        handleAddToQueue();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function init() {
    try {
      const authed = await isAuthenticated();
      if (!authed) {
        setLoading(false);
        return;
      }

      const token = await getAccessToken();
      if (token) await fetchUser(token);

      const params = new URLSearchParams(window.location.search);
      const summaryId = params.get("id");

      const [queueRes, usageRes] = await Promise.all([getQueue(), getUsage()]);
      setSummaries(queueRes.items);
      setUsage(usageRes.usage);

      if (summaryId) {
        const summaryRes = await getSummary(summaryId);
        setSelectedSummary(summaryRes.summary);
        setView("detail");
      }

      await detectVideo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function fetchUser(token: string) {
    const apiUrl = (import.meta.env.VITE_API_URL as string) ?? "http://localhost:3001";
    const res = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to load account");
    const data = await res.json();
    setUser({ email: data.user.email, plan: data.user.plan });
  }

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    const response = (await browser.runtime.sendMessage({ type: "SIGN_IN" })) as {
      success: boolean;
      error?: string;
    };
    if (response?.success) {
      await init();
    } else {
      setError(response?.error ?? "Sign in failed");
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await browser.runtime.sendMessage({ type: "SIGN_OUT" });
    setUser(null);
    setVideo(null);
    setAddStatus("idle");
    setSummaries([]);
    setUsage(null);
  }

  async function detectVideo() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && tab.url?.includes("youtube.com/watch")) {
        const info = (await browser.tabs.sendMessage(tab.id, {
          type: "GET_VIDEO_INFO",
        })) as VideoInfo;
        if (info?.videoId) {
          setVideo(info);
          setAddStatus("idle");
          return;
        }
      }
      setVideo(null);
    } catch {
      setVideo(null);
    }
  }

  async function fetchQueueAndUsage() {
    try {
      const [queueRes, usageRes] = await Promise.all([getQueue(), getUsage()]);
      setSummaries(queueRes.items);
      setUsage(usageRes.usage);
    } catch {
      // Silently fail
    }
  }

  async function handleAddToQueue() {
    if (!video?.videoId) return;
    setIsAdding(true);
    setAddError(undefined);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "ADD_TO_QUEUE",
        videoUrl: video.url,
        videoTitle: video.title,
        videoChannel: video.channel ?? undefined,
        videoDurationSeconds: video.duration
          ? (parseDurationToSeconds(video.duration) ?? undefined)
          : undefined,
      })) as { success: boolean; error?: string };
      if (response?.success) {
        setAddStatus("queued");
        await fetchQueueAndUsage();
      } else {
        setAddStatus("error");
        setAddError(response?.error ?? "Failed to add to queue");
      }
    } catch (err) {
      setAddStatus("error");
      setAddError(err instanceof Error ? err.message : "Failed to add to queue");
    } finally {
      setIsAdding(false);
    }
  }

  function handleViewSummary(id: string) {
    const match = summaries.find((s) => s.id === id);
    if (match) {
      setSelectedSummary(match);
      setView("detail");
    }
  }

  function handleBack() {
    setSelectedSummary(null);
    setView("dashboard");
  }

  function handlePopOut(id: string) {
    const url = browser.runtime.getURL(`/summaries.html#/summary/${id}`);
    browser.tabs.create({ url });
  }

  async function handleRemoveItem(id: string) {
    setSummaries((prev) => prev.filter((s) => s.id !== id));
    try {
      await deleteQueueItem(id);
    } catch {
      fetchQueueAndUsage();
    }
  }

  async function handleRetryItem(id: string) {
    const original = summaries.find((s) => s.id === id);
    setSummaries((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: "pending" as const, errorMessage: undefined } : s,
      ),
    );
    try {
      await retryQueueItem(id);
    } catch {
      if (original) {
        setSummaries((prev) => prev.map((s) => (s.id === id ? original : s)));
      }
    }
  }

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
          <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse [animation-delay:0.2s]" />
          <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse [animation-delay:0.4s]" />
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <div className="p-4">
        <h1 className="text-lg font-extrabold m-0">
          <span className="text-indigo-500">&#9654;</span> Cliphy
        </h1>
        <p className="text-gray-600 mt-2 text-sm">
          Queue YouTube videos and get AI-powered summaries.
        </p>
        <button
          onClick={handleSignIn}
          className="mt-4 px-5 py-2.5 text-sm bg-indigo-600 text-white border-2 border-black rounded-lg shadow-brutal hover:shadow-brutal-hover press-down font-bold cursor-pointer w-full"
        >
          Sign in with Google
        </button>
        {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="p-4">
        <h1 className="text-lg font-extrabold m-0">
          <span className="text-indigo-500">&#9654;</span> Cliphy
        </h1>
        <div className="mt-4 bg-red-50 border-2 border-black rounded-lg p-3">
          <p className="text-sm text-red-700 font-bold m-0">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              init();
            }}
            className="mt-2 text-xs font-bold px-3 py-1.5 bg-white border-2 border-black rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Detail view
  if (view === "detail" && selectedSummary) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={handleBack}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer p-0 transition-colors"
          >
            &larr; Back
          </button>
          <button
            onClick={() => handlePopOut(selectedSummary.id)}
            className="text-xs text-gray-400 hover:text-black bg-transparent border-0 cursor-pointer p-0 transition-colors"
          >
            Pop out &#x2197;
          </button>
        </div>
        <SummaryDetail summary={selectedSummary} onSeek={seekVideo} />
      </div>
    );
  }

  // Dashboard view
  return (
    <div className="p-4 flex flex-col min-h-screen">
      <h1 className="text-lg font-extrabold m-0">
        <span className="text-indigo-500">&#9654;</span> Cliphy
      </h1>

      {video && (
        <div className="mt-3">
          <VideoCard
            video={video}
            onAdd={handleAddToQueue}
            isAdding={isAdding}
            status={addStatus}
            error={addError}
          />
        </div>
      )}

      <div className="mt-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Queue</h2>
        <QueueList
          summaries={summaries}
          onViewSummary={handleViewSummary}
          onRemove={handleRemoveItem}
          onRetry={handleRetryItem}
          onViewAll={() => {
            const url = browser.runtime.getURL("/summaries.html");
            browser.tabs.create({ url });
          }}
        />
      </div>

      <div className="mt-auto pt-4 border-t border-gray-200">
        {usage && (
          <div className="mb-2">
            <UsageBar usage={usage} />
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{user.email}</span>
          <button
            onClick={handleSignOut}
            className="bg-transparent border-0 p-0 text-xs text-gray-400 hover:text-black cursor-pointer transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
