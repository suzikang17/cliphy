import type { ExtensionMessage, Summary, UsageInfo, VideoInfo } from "@cliphy/shared";
import { useEffect, useState } from "react";
import { QueueList } from "../../components/QueueList";
import { UsageBar } from "../../components/UsageBar";
import { VideoCard } from "../../components/VideoCard";
import { deleteQueueItem, getQueue, getUsage } from "../../lib/api";
import { getAccessToken, isAuthenticated } from "../../lib/auth";

interface UserInfo {
  email: string;
  plan: string;
}

export function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addStatus, setAddStatus] = useState<"idle" | "queued" | "processing" | "error">("idle");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    checkAuth();
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
        // New item — prepend
        return [updated, ...prev];
      });

      // Refresh usage when a summary completes (count may have changed)
      if (updated.status === "completed" || updated.status === "failed") {
        getUsage()
          .then((res) => setUsage(res.usage))
          .catch(() => {});
      }
    };

    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  async function checkAuth() {
    try {
      const authed = await isAuthenticated();
      if (authed) {
        const token = await getAccessToken();
        if (token) {
          await fetchUser(token);
          await Promise.all([detectVideo(), fetchQueueAndUsage()]);
        }
      }
    } catch {
      // Not authenticated, show sign-in
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

  async function fetchQueueAndUsage() {
    try {
      const [queueRes, usageRes] = await Promise.all([getQueue(), getUsage()]);
      setSummaries(queueRes.items);
      setUsage(usageRes.usage);
    } catch {
      // Silently fail — queue/usage are non-critical
    }
  }

  async function detectVideo() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && tab.url?.includes("youtube.com/watch")) {
        const info = (await browser.tabs.sendMessage(tab.id, {
          type: "GET_VIDEO_INFO",
        })) as VideoInfo;
        if (info?.videoId) setVideo(info);
      }
    } catch {
      // Not on a YouTube video page or content script not loaded
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

  async function handleViewSummary(id: string) {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await browser.sidePanel.setOptions({
          tabId: tab.id,
          path: `/sidepanel.html?id=${id}`,
          enabled: true,
        });
        await browser.sidePanel.open({ tabId: tab.id });
      }
    } catch {
      // Fallback to full tab
      const url = browser.runtime.getURL(`/summaries.html#/summary/${id}`);
      browser.tabs.create({ url });
    }
    window.close();
  }

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    const response = (await browser.runtime.sendMessage({ type: "SIGN_IN" })) as {
      success: boolean;
      error?: string;
    };
    if (response?.success) {
      await checkAuth();
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
          <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse [animation-delay:0.2s]" />
          <div className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse [animation-delay:0.4s]" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-extrabold m-0">Cliphy</h1>
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

  return (
    <div className="p-4 flex flex-col min-h-[400px]">
      <h1 className="text-xl m-0 font-extrabold">
        <span className="text-indigo-500 text-xl">&#9654;</span> Cliphy
      </h1>
      {usage && (
        <div className="mt-4">
          <UsageBar usage={usage} />
        </div>
      )}

      {video && (
        <div className="mt-4">
          <VideoCard
            video={video}
            onAdd={handleAddToQueue}
            isAdding={isAdding}
            status={addStatus}
            error={addError}
          />
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500">Queue</h2>
          {summaries.some((s) => s.status === "failed") && (
            <button
              disabled={isClearing}
              onClick={async () => {
                setIsClearing(true);
                const failed = summaries.filter((s) => s.status === "failed");
                await Promise.allSettled(failed.map((s) => deleteQueueItem(s.id)));
                setSummaries((prev) => prev.filter((s) => s.status !== "failed"));
                setIsClearing(false);
              }}
              className="bg-transparent border-0 p-0 text-[10px] text-red-400 hover:text-red-600 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isClearing ? "Clearing..." : "Clear failed"}
            </button>
          )}
        </div>
        <QueueList
          summaries={summaries}
          onViewSummary={handleViewSummary}
          onViewAll={() => {
            browser.tabs.create({ url: browser.runtime.getURL("/summaries.html") });
            window.close();
          }}
        />
      </div>

      <div className="mt-auto pt-4 flex items-center justify-between text-xs text-gray-400">
        <span>{user.email}</span>
        <button
          onClick={handleSignOut}
          className="bg-transparent border-0 p-0 text-xs text-gray-400 hover:text-black cursor-pointer transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
