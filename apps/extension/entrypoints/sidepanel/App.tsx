import type { ExtensionMessage, Summary, UsageInfo, VideoInfo } from "@cliphy/shared";
import { parseDurationToSeconds } from "@cliphy/shared";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../../components/Logo";
import { Onboarding } from "../../components/Onboarding";
import { QueueList } from "../../components/QueueList";
import { SummaryDetail, ExportBar, toMarkdown, toPlainText } from "../../components/SummaryDetail";
import { UpgradePrompt } from "../../components/UpgradePrompt";
import { UsageBar } from "../../components/UsageBar";
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
import { openCheckout } from "../../lib/checkout";
import { get as storageGet, set as storageSet } from "../../lib/storage";
import { startRealtimeSubscription, stopRealtimeSubscription } from "../../lib/supabase";

type View = "dashboard" | "detail";

async function seekVideo(seconds: number, videoId?: string) {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // If on a different video (or not on YouTube), navigate to the right one
    const isOnVideo = tab.url?.includes(`youtube.com/watch`) && tab.url.includes(`v=${videoId}`);
    if (videoId && !isOnVideo) {
      await browser.tabs.update(tab.id, {
        url: `https://www.youtube.com/watch?v=${videoId}&t=${seconds}`,
      });
      return;
    }

    await browser.tabs.sendMessage(tab.id, { type: "SEEK_VIDEO", seconds });
  } catch {
    // Content script not available — open the video in the current tab
    if (videoId) {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await browser.tabs.update(tab.id, {
          url: `https://www.youtube.com/watch?v=${videoId}&t=${seconds}`,
        });
      }
    }
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
  const [videoLoading, setVideoLoading] = useState(false);
  const dismissedVideoRef = useRef<string | null>(null);
  const [loadingVideoId, setLoadingVideoId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addStatus, setAddStatus] = useState<"idle" | "queued" | "processing" | "error">("idle");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgradePrompt, setUpgradePrompt] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [copyMarkdown, setCopyMarkdown] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied">("idle");

  const realtimeStarted = useRef(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  // Close user menu on click outside
  useEffect(() => {
    if (!showUserMenu) return;
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showUserMenu]);

  // Listen for VIDEO_DETECTED from content script (has metadata after DOM loads)
  // and re-detect on tab navigation
  useEffect(() => {
    const onMessage = (message: unknown) => {
      const msg = message as ExtensionMessage;
      if (msg.type === "VIDEO_DETECTED" && msg.video?.videoId) {
        if (msg.video.videoId !== dismissedVideoRef.current) {
          dismissedVideoRef.current = null;
        }
        // Only show the card once we have a title (initial message has empty title)
        if (msg.video.title) {
          setVideo(msg.video);
          setVideoLoading(false);
          setLoadingVideoId(null);
        } else {
          setVideo(null);
          setVideoLoading(true);
          setLoadingVideoId(msg.video.videoId);
        }
        setAddStatus("idle");
      }
    };

    const onUpdated = (_tabId: number, changeInfo: { url?: string }) => {
      if (changeInfo.url) {
        // Clear stale video card — content script will send fresh VIDEO_DETECTED
        setVideo(null);
        setVideoLoading(changeInfo.url.includes("youtube.com/watch"));
        setAddStatus("idle");
      }
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
        setVideoLoading(true);
        const info = (await browser.tabs.sendMessage(tab.id, {
          type: "GET_VIDEO_INFO",
        })) as VideoInfo;
        if (info?.videoId) {
          setVideo(info);
          setVideoLoading(false);
          setAddStatus("idle");
          return;
        }
      }
      setVideo(null);
      setVideoLoading(false);
    } catch {
      setVideo(null);
      setVideoLoading(false);
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
    const s = summaries.find((s) => s.id === id);
    if (s) {
      setSelectedSummary(s);
      setView("detail");
    }
  }

  function handleOpenSummary(id: string) {
    const url = browser.runtime.getURL(`/summaries.html#/summary/${id}`);
    browser.tabs.create({ url });
  }

  function handleBack() {
    setSelectedSummary(null);
    setView("dashboard");
  }

  async function handleRemoveItem(id: string) {
    const item = summaries.find((s) => s.id === id);
    // If removing the current video's summary, dismiss so it doesn't reappear as "Add to Queue"
    if (item && video && item.videoId === video.videoId) {
      dismissedVideoRef.current = video.videoId;
    }
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

  const currentVideo = video && dismissedVideoRef.current !== video.videoId ? video : null;

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
      {user && (
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu((v) => !v)}
            className="text-[10px] font-bold text-(--color-text-faint) hover:text-(--color-text) bg-transparent border-0 cursor-pointer transition-colors truncate max-w-[160px]"
          >
            {user.email} &#9662;
          </button>
          {showUserMenu && (
            <div className="absolute right-0 top-full mt-1 w-fit bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm py-1 z-20">
              {user.plan === "pro" && (
                <div className="px-3 py-1.5 text-[10px] font-bold text-neon-600 text-left border-b border-(--color-border-soft) mb-1">
                  Pro Plan
                </div>
              )}
              {user.plan === "pro" && (
                <button
                  onClick={async () => {
                    setShowUserMenu(false);
                    try {
                      const { url } = await createPortal();
                      await browser.tabs.create({ url });
                    } catch {
                      // silently fail
                    }
                  }}
                  className="w-full text-left text-xs px-3 py-1.5 bg-transparent border-0 cursor-pointer hover:bg-(--color-surface-raised) transition-colors text-(--color-text)"
                >
                  Billing
                </button>
              )}
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  handleSignOut();
                }}
                className="w-full text-left text-xs px-3 py-1.5 bg-transparent border-0 cursor-pointer hover:bg-(--color-surface-raised) transition-colors text-(--color-text)"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
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
            <h2 className="text-xl font-extrabold m-0 flex items-center justify-center gap-1.5">
              <Logo size={28} /> Cliphy
            </h2>
            <p className="text-sm text-(--color-text-muted) m-0 mt-1">
              YouTube summaries in seconds
            </p>
          </div>

          <div className="space-y-2.5 mb-6">
            <div className="bg-(--color-accent-surface) rounded-lg p-3 flex items-start gap-3">
              <span className="text-lg shrink-0">&#128203;</span>
              <div>
                <p className="text-sm font-bold m-0">Queue any video</p>
                <p className="text-xs text-(--color-text-muted) m-0 mt-0.5">
                  Add videos while you browse
                </p>
              </div>
            </div>
            <div className="bg-(--color-surface-raised) rounded-lg p-3 flex items-start gap-3">
              <span className="text-lg shrink-0">&#9889;</span>
              <div>
                <p className="text-sm font-bold m-0">AI summary in ~30s</p>
                <p className="text-xs text-(--color-text-muted) m-0 mt-0.5">
                  Skip the fluff, get the insights
                </p>
              </div>
            </div>
            <div className="bg-(--color-surface-raised) rounded-lg p-3 flex items-start gap-3">
              <span className="text-lg shrink-0">&#127919;</span>
              <div>
                <p className="text-sm font-bold m-0">Key points &amp; timestamps</p>
                <p className="text-xs text-(--color-text-muted) m-0 mt-0.5">
                  Jump to what matters most
                </p>
              </div>
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

  // Detail view
  if (view === "detail" && selectedSummary) {
    async function handleCopyAll() {
      const content = copyMarkdown ? toMarkdown(selectedSummary!) : toPlainText(selectedSummary!);
      try {
        await navigator.clipboard.writeText(content);
        setCopied("copied");
        setTimeout(() => setCopied("idle"), 2000);
      } catch {
        // Clipboard API can fail in extension contexts
      }
    }

    return (
      <div className="flex flex-col h-screen">
        {topBar}
        <div className="flex-1 overflow-y-auto p-4">
          <SummaryDetail
            summary={selectedSummary}
            onSeek={(seconds) => seekVideo(seconds, selectedSummary.videoId)}
            onDismiss={() => handleDismissSummary(selectedSummary.id)}
            onOpenInTab={() => handleOpenSummary(selectedSummary.id)}
            pinned
            copyAsMarkdown={copyMarkdown}
          />
        </div>
        <div className="shrink-0 p-4 pt-3 border-t border-(--color-border-soft)">
          <ExportBar
            copied={copied}
            copyMarkdown={copyMarkdown}
            setCopyMarkdown={setCopyMarkdown}
            onCopy={handleCopyAll}
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

      {showOnboarding && (
        <Onboarding
          onComplete={async () => {
            await storageSet("onboarding_completed", true);
            setShowOnboarding(false);
          }}
        />
      )}

      <div className="shrink-0 px-4 pt-3 pb-0">
        {upgradePrompt && (
          <div className="mb-3">
            <UpgradePrompt
              message={upgradePrompt}
              onDismiss={() => setUpgradePrompt(null)}
              onUpgraded={handleUpgraded}
            />
          </div>
        )}
        {usage && usage.plan === "free" && !upgradePrompt && (
          <button
            onClick={() => openCheckout(handleUpgraded)}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 mb-3 bg-neon-100 dark:bg-neon-900/50 text-neon-700 dark:text-neon-400 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed hover:bg-neon-200 dark:hover:bg-neon-900/70 press-down cursor-pointer transition-all"
          >
            ✦ Unlock 100 summaries/month with Pro
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-2">
        <QueueList
          summaries={summaries}
          currentVideo={currentVideo}
          videoLoading={videoLoading}
          loadingVideoId={loadingVideoId}
          onAddToQueue={handleAddToQueue}
          isAdding={isAdding}
          addStatus={addStatus}
          addError={addError}
          atLimit={usage ? usage.used >= usage.limit : false}
          onUpgrade={() => openCheckout(handleUpgraded)}
          onViewSummary={handleViewSummary}
          onOpenSummary={handleOpenSummary}
          onRemove={handleRemoveItem}
          onRetry={handleRetryItem}
        />
      </div>

      <div className="shrink-0 p-4 pt-3 border-t border-(--color-border-soft)">
        {usage && (
          <div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <UsageBar usage={usage} onUpgraded={handleUpgraded} />
              </div>
              <button
                onClick={() => {
                  const url = browser.runtime.getURL("/summaries.html");
                  browser.tabs.create({ url });
                }}
                className="text-xs font-bold text-neon-900 bg-neon-200 dark:bg-transparent dark:text-neon-400 border-2 border-(--color-border-hard) rounded-full px-3 py-1 shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all shrink-0"
              >
                View all
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
