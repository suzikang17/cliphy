import type { Summary, UsageInfo, VideoInfo } from "@cliphy/shared";
import { useEffect, useState } from "react";
import { QueueList } from "../../components/QueueList";
import { UsageBar } from "../../components/UsageBar";
import { VideoCard } from "../../components/VideoCard";
import { getQueue, getUsage } from "../../lib/api";
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

  useEffect(() => {
    checkAuth();
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
    const apiUrl = (import.meta.env.VITE_API_URL as string) ?? "http://localhost:3000";
    const res = await fetch(`${apiUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setUser({ email: data.user.email, plan: data.user.plan });
    }
  }

  async function fetchQueueAndUsage() {
    try {
      const [queueRes, usageRes] = await Promise.all([getQueue(), getUsage()]);
      setSummaries(queueRes.summaries);
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
    // summaries.html will be added in a future task — cast to bypass WXT's PublicPath type
    const url = browser.runtime.getURL(`/summaries.html#/summary/${id}` as `/popup.html`);
    browser.tabs.create({ url });
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
      <div className="p-4 text-center">
        <p className="text-gray-500 text-sm">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-4">
        <h1 className="text-xl m-0 font-semibold">Cliphy</h1>
        <p className="text-gray-500 mt-2">Queue YouTube videos and get AI-powered summaries.</p>
        <button
          onClick={handleSignIn}
          className="mt-4 px-5 py-2.5 text-sm bg-blue-600 text-white border-none rounded cursor-pointer w-full hover:bg-blue-700"
        >
          Sign in with Google
        </button>
        {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl m-0 font-semibold">Cliphy</h1>
        <button
          onClick={handleSignOut}
          className="px-3 py-1.5 text-xs bg-transparent text-gray-500 border border-gray-300 rounded cursor-pointer hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>
      <p className="mt-1 text-sm text-gray-600">{user.email}</p>

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
        <h2 className="text-sm font-medium text-gray-700 mb-2">Queue</h2>
        <QueueList summaries={summaries} onViewSummary={handleViewSummary} />
      </div>

      <div className="mt-4 text-center">
        <button
          onClick={() => {
            // summaries.html will be added in a future task — cast to bypass WXT's PublicPath type
            const url = browser.runtime.getURL("/summaries.html" as "/popup.html");
            browser.tabs.create({ url });
            window.close();
          }}
          className="text-sm text-blue-600 hover:text-blue-700 bg-transparent border-none cursor-pointer"
        >
          View all summaries &rarr;
        </button>
      </div>
    </div>
  );
}
