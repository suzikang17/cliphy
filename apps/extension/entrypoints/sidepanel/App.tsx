import type { ExtensionMessage, Summary, UsageInfo, VideoInfo } from "@cliphy/shared";
import { formatTimeSaved, FREE_HISTORY_DAYS, parseDurationToSeconds } from "@cliphy/shared";
import { useEffect, useRef, useState } from "react";
import { Onboarding } from "../../components/Onboarding";
import { QueueList } from "../../components/QueueList";
import { SummaryDetail } from "../../components/SummaryDetail";
import { UpgradePrompt } from "../../components/UpgradePrompt";
import { UsageBar } from "../../components/UsageBar";
import { VideoCard } from "../../components/VideoCard";
import {
  AuthError,
  createPortal,
  deleteQueueItem,
  deleteSummary,
  getQueue,
  getSummary,
  getUsage,
  getUser,
  ProRequiredError,
  retryQueueItem,
} from "../../lib/api";
import { getAccessToken, getUserIdFromToken } from "../../lib/auth";
import { get as storageGet, set as storageSet } from "../../lib/storage";
import { startRealtimeSubscription, stopRealtimeSubscription } from "../../lib/supabase";

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
  const [upgradePrompt, setUpgradePrompt] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const realtimeStarted = useRef(false);

  useEffect(() => {
    init();
  }, []);

  // Direct Supabase realtime subscription (survives background service worker shutdown)
  useEffect(() => {
    if (!user || realtimeStarted.current) return;

    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const userId = getUserIdFromToken(token);
      if (!userId) return;

      realtimeStarted.current = true;
      startRealtimeSubscription(
        userId,
        (updated) => {
          // Soft-deleted summaries: remove from list, don't re-add
          if (updated.deletedAt) {
            setSummaries((prev) => prev.filter((s) => s.id !== updated.id));
            return;
          }

          const statusPriority: Record<string, number> = {
            pending: 0,
            processing: 1,
            completed: 2,
            failed: 2,
          };
          setSummaries((prev) => {
            const idx = prev.findIndex((s) => s.id === updated.id);
            if (idx >= 0) {
              // Never downgrade status (realtime events can arrive out of order)
              const current = prev[idx];
              if ((statusPriority[updated.status] ?? 0) < (statusPriority[current.status] ?? 0)) {
                return prev;
              }
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
        },
        token,
      );
    })();

    return () => {
      stopRealtimeSubscription();
      realtimeStarted.current = false;
    };
  }, [user]);

  async function handleUpgraded() {
    await fetchUser().catch(() => {});
    const res = await getUsage().catch(() => null);
    if (res) setUsage(res.usage);
  }

  // Re-fetch user + usage when sidepanel becomes visible
  useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") handleUpgraded();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user]);

  // Listen for VIDEO_DETECTED from content script (has metadata after DOM loads)
  // and re-detect on tab navigation
  useEffect(() => {
    const onMessage = (message: unknown) => {
      const msg = message as ExtensionMessage;
      if (msg.type === "VIDEO_DETECTED" && msg.video?.videoId) {
        setVideo(msg.video);
        setAddStatus("idle");
      }
    };

    const onUpdated = (_tabId: number, changeInfo: { url?: string }) => {
      if (changeInfo.url) detectVideo();
    };
    const onActivated = () => detectVideo();

    browser.runtime.onMessage.addListener(onMessage);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onActivated.addListener(onActivated);
    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
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
      const token = await getAccessToken();
      if (!token) {
        setLoading(false);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const summaryId = params.get("id");

      const [, queueRes, usageRes, , summaryRes] = await Promise.all([
        fetchUser(),
        getQueue(),
        getUsage(),
        detectVideo(),
        summaryId ? getSummary(summaryId) : null,
      ]);

      setSummaries(queueRes.items);
      setUsage(usageRes.usage);

      if (summaryRes) {
        setSelectedSummary(summaryRes.summary);
        setView("detail");
      }

      const onboarded = await storageGet<boolean>("onboarding_completed");
      if (!onboarded) {
        setShowOnboarding(true);
      }
    } catch (err) {
      if (err instanceof Error && err.message === "SESSION_EXPIRED") return;
      console.error("[Cliphy] init failed:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchUser() {
    try {
      const data = await getUser();
      setUser({ email: data.user.email, plan: data.user.plan });
    } catch (err) {
      if (err instanceof AuthError) {
        // Truly expired session — clear and treat as unauthenticated
        await browser.runtime.sendMessage({ type: "SIGN_OUT" });
        setUser(null);
        throw new Error("SESSION_EXPIRED", { cause: err });
      }
      // Network/server errors — don't sign out, let UI show the error
      throw err;
    }
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
      const msg = response?.error ?? "Sign in failed";
      console.error("[Cliphy] sign-in failed:", msg);
      const cancelled = /cancelled|canceled|not approve/i.test(msg);
      setError(
        cancelled
          ? "Sign in unsuccessful. Please try again with your Google account."
          : "Something went wrong. Please try again.",
      );
      setLoading(false);
    }
  }

  async function handleSignOut() {
    stopRealtimeSubscription();
    realtimeStarted.current = false;
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
    setUpgradePrompt(null);
    try {
      const response = (await browser.runtime.sendMessage({
        type: "ADD_TO_QUEUE",
        videoUrl: video.url,
        videoTitle: video.title,
        videoChannel: video.channel ?? undefined,
        videoDurationSeconds: video.duration
          ? (parseDurationToSeconds(video.duration) ?? undefined)
          : undefined,
      })) as {
        success: boolean;
        error?: string;
        code?: string;
        upgrade_url?: string;
        limit?: number;
        plan?: string;
      };
      if (response?.success) {
        setAddStatus("queued");
        await fetchQueueAndUsage();
      } else if (response?.code === "pro_required") {
        setAddStatus("idle");
        setUpgradePrompt(response.error ?? "This feature requires Pro");
      } else if (response?.code === "rate_limited") {
        setAddStatus("idle");
        const limit = response.limit ?? 5;
        const plan = response.plan ?? "free";
        setUpgradePrompt(
          `Monthly limit reached (${limit}/${limit} summaries on ${plan} plan). Upgrade for more.`,
        );
      } else {
        console.error("[Cliphy] add-to-queue failed:", response?.error);
        setAddStatus("error");
        setAddError(response?.error || "Unable to add video. Please try again.");
      }
    } catch (err) {
      if (err instanceof ProRequiredError) {
        setAddStatus("idle");
        setUpgradePrompt(err.message);
      } else {
        console.error("[Cliphy] add-to-queue error:", err);
        setAddStatus("error");
        setAddError("Unable to add video. Please try again.");
      }
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
    const item = summaries.find((s) => s.id === id);
    setSummaries((prev) => prev.filter((s) => s.id !== id));
    try {
      if (item?.status === "completed") {
        await deleteSummary(id);
      } else {
        await deleteQueueItem(id);
      }
    } catch {
      fetchQueueAndUsage();
    }
  }

  async function handleDismissSummary(id: string) {
    setSummaries((prev) => prev.filter((s) => s.id !== id));
    setSelectedSummary(null);
    setView("dashboard");
    try {
      await deleteSummary(id);
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

  // Sticky top bar (shared across all views)
  const topBar = (
    <div className="sticky top-0 z-10 bg-(--color-surface) border-b border-(--color-border-soft) px-4 py-3 shrink-0 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {view === "detail" && (
          <button
            onClick={handleBack}
            className="text-sm font-bold text-neon-600 hover:text-neon-800 bg-transparent border-0 cursor-pointer p-0 transition-colors"
          >
            &larr;
          </button>
        )}
        <h1 className="text-lg font-extrabold m-0 flex items-center gap-1.5">
          <span className="text-neon-500">&#9654;</span>
          Cliphy
        </h1>
      </div>
      <button
        onClick={() => {
          if (view === "detail" && selectedSummary) {
            handlePopOut(selectedSummary.id);
          } else {
            const url = browser.runtime.getURL("/summaries.html");
            browser.tabs.create({ url });
          }
        }}
        className="text-xs text-(--color-text-faint) hover:text-(--color-text) bg-transparent border-0 cursor-pointer p-0 transition-colors"
      >
        Pop out &#x2197;
      </button>
    </div>
  );

  // Loading
  if (loading) {
    return (
      <div className="flex flex-col h-screen">
        {topBar}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex gap-1.5">
            <div className="w-2 h-2 rounded-full bg-neon-600 animate-pulse" />
            <div className="w-2 h-2 rounded-full bg-neon-600 animate-pulse [animation-delay:0.2s]" />
            <div className="w-2 h-2 rounded-full bg-neon-600 animate-pulse [animation-delay:0.4s]" />
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated — welcome screen
  if (!user) {
    return (
      <div className="flex flex-col h-screen">
        {topBar}
        <div className="p-4">
          <div className="text-center mb-4 mt-2">
            <h2 className="text-xl font-extrabold m-0">
              <span className="text-neon-500">&#9654;</span> Cliphy
            </h2>
            <p className="text-sm text-(--color-text-muted) m-0 mt-1">
              YouTube summaries in seconds
            </p>
          </div>

          <div className="space-y-2 mb-6">
            <div className="flex items-center gap-2.5 text-sm">
              <span className="text-base">&#128203;</span>
              <span>Queue any video</span>
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <span className="text-base">&#9889;</span>
              <span>AI summary in ~30s</span>
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <span className="text-base">&#127919;</span>
              <span>Key points &amp; timestamps</span>
            </div>
          </div>

          <button
            onClick={handleSignIn}
            className="px-5 py-2.5 text-sm bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-lg shadow-brutal hover:shadow-brutal-hover press-down font-bold cursor-pointer w-full"
          >
            Sign in with Google
          </button>
          {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="flex flex-col h-screen">
        {topBar}
        <div className="p-4">
          <div className="bg-(--color-error-surface) border-2 border-(--color-border-hard) rounded-lg p-3">
            <p className="text-sm text-red-700 font-bold m-0">{error}</p>
            <button
              onClick={() => {
                setError(null);
                setLoading(true);
                init();
              }}
              className="mt-2 text-xs font-bold px-3 py-1.5 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Post-sign-in onboarding
  if (showOnboarding) {
    return (
      <div className="flex flex-col h-screen">
        {topBar}
        <Onboarding
          onComplete={async () => {
            await storageSet("onboarding_completed", true);
            setShowOnboarding(false);
          }}
        />
      </div>
    );
  }

  // Detail view
  if (view === "detail" && selectedSummary) {
    return (
      <div className="flex flex-col h-screen">
        {topBar}
        <div className="flex-1 overflow-y-auto p-4">
          <SummaryDetail
            summary={selectedSummary}
            onSeek={seekVideo}
            onDismiss={() => handleDismissSummary(selectedSummary.id)}
          />
        </div>
      </div>
    );
  }

  // Dashboard view
  return (
    <div className="flex flex-col h-screen">
      {topBar}

      <div className="shrink-0 px-4 pt-3 pb-0">
        {usage && usage.totalTimeSavedSeconds > 0 && (
          <div className="flex items-center gap-1.5 mb-3">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-neon-500 shrink-0"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="text-sm font-extrabold">
              {formatTimeSaved(usage.totalTimeSavedSeconds)} saved
            </span>
          </div>
        )}

        {video && (
          <div className="mb-3">
            <VideoCard
              video={video}
              onAdd={handleAddToQueue}
              isAdding={isAdding}
              status={addStatus}
              error={addError}
              existingStatus={summaries.find((s) => s.videoId === video.videoId)?.status}
              onViewExisting={() => {
                const match = summaries.find((s) => s.videoId === video.videoId);
                if (match) handleViewSummary(match.id);
              }}
            />
          </div>
        )}

        {upgradePrompt && (
          <div className="mb-3">
            <UpgradePrompt
              message={upgradePrompt}
              onDismiss={() => setUpgradePrompt(null)}
              onUpgraded={handleUpgraded}
            />
          </div>
        )}

        <div className="flex items-center gap-1.5 mb-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-(--color-text-muted) m-0">
            Queue
          </h2>
          {user.plan === "free" && (
            <span className="text-[9px] text-(--color-text-faint)">
              (last {FREE_HISTORY_DAYS} days)
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-2">
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

      <div className="shrink-0 p-4 pt-3 border-t border-(--color-border-soft)">
        {usage && (
          <div className="mb-3">
            <UsageBar usage={usage} onUpgraded={handleUpgraded} />
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-(--color-text-faint)">
          <div className="flex items-center gap-1.5 min-w-0">
            {user.plan === "pro" && (
              <button
                onClick={async () => {
                  try {
                    const { url } = await createPortal();
                    await browser.tabs.create({ url });
                  } catch {
                    // silently fail
                  }
                }}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 shrink-0 border-0 cursor-pointer hover:bg-indigo-200 transition-colors"
              >
                Pro &#x2197;
              </button>
            )}
            <span className="truncate">{user.email}</span>
          </div>
          <button
            onClick={handleSignOut}
            className="bg-transparent border-0 p-0 text-xs text-(--color-text-faint) hover:text-(--color-text) cursor-pointer transition-colors shrink-0 ml-2"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
