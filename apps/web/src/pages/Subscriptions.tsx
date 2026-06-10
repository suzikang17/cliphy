import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { Subscription, SubscriptionType } from "@cliphy/shared";
import { relativeDate } from "@cliphy/shared";
import { Nav } from "../components/Nav";
import * as api from "../lib/api";

const YOUTUBE_NON_CHANNEL_PATHS =
  /^\/(feed|trending|gaming|music|live|premium|account|results|shorts|watch|embed)\b/;

function inferType(url: string): SubscriptionType | null {
  if (/[?&]list=/.test(url) || /\/playlist\b/.test(url)) return "playlist";
  if (/\/@|\/channel\/|\/c\/|\/user\//.test(url)) return "channel";
  try {
    const { pathname } = new URL(url);
    if (
      /youtube\.com/.test(url) &&
      /^\/[^/?#\s]+$/.test(pathname) &&
      !YOUTUBE_NON_CHANNEL_PATHS.test(pathname)
    )
      return "channel";
  } catch {
    // invalid URL
  }
  return null;
}

const TYPE_LABELS: Record<SubscriptionType, string> = {
  channel: "Channel",
  playlist: "Playlist",
  watch_later: "Watch Later",
  liked: "Liked Videos",
};

const TYPE_COLORS: Record<SubscriptionType, string> = {
  channel:
    "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700",
  playlist:
    "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700",
  watch_later:
    "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700",
  liked:
    "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700",
};

export function Subscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addUrl, setAddUrl] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const googleConnectedParam = searchParams.get("google_connected");
    const googleErrorParam = searchParams.get("google_error");
    if (googleConnectedParam === "true") {
      setNotice("Google account connected.");
      setSearchParams({}, { replace: true });
    } else if (googleErrorParam) {
      setError(`Failed to connect Google: ${googleErrorParam.replace(/_/g, " ")}`);
      setSearchParams({}, { replace: true });
    }
    load();
  }, []);

  async function load() {
    try {
      const [subsRes, googleRes, usageRes] = await Promise.all([
        api.getSubscriptions(),
        api.getGoogleStatus(),
        api.getUsage(),
      ]);
      setSubscriptions(subsRes.subscriptions);
      setGoogleConnected(googleRes.connected);
      setIsPro(usageRes.usage.plan === "pro");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const url = addUrl.trim();
    if (!url) return;
    const type = inferType(url);
    if (!type) {
      setAddError("Paste a YouTube channel or playlist URL");
      return;
    }
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await api.createSubscription({ type, sourceUrl: url });
      setSubscriptions((prev) => [...prev, res.subscription]);
      setAddUrl("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add subscription");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleAddWatchLater() {
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await api.createSubscription({ type: "watch_later" });
      setSubscriptions((prev) => [...prev, res.subscription]);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add Watch Later subscription");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleToggle(id: string, newActive: boolean) {
    setSubscriptions((prev) => prev.map((s) => (s.id === id ? { ...s, isActive: newActive } : s)));
    try {
      await api.updateSubscription(id, { isActive: newActive });
    } catch {
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isActive: !newActive } : s)),
      );
    }
  }

  async function handleDelete(id: string) {
    setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    try {
      await api.deleteSubscription(id);
    } catch {
      await load();
    }
  }

  async function handleConnectGoogle() {
    setConnectingGoogle(true);
    try {
      const { url } = await api.getGoogleConnectUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect Google");
      setConnectingGoogle(false);
    }
  }

  async function handleDisconnectGoogle() {
    setDisconnectingGoogle(true);
    try {
      await api.disconnectGoogle();
      setGoogleConnected(false);
      setSubscriptions((prev) => prev.filter((s) => s.type !== "watch_later"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Google");
    } finally {
      setDisconnectingGoogle(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-6">
        <Nav />
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-3 border-neon-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const hasWatchLater = subscriptions.some((s) => s.type === "watch_later");

  return (
    <div className="max-w-2xl mx-auto px-6 pb-16">
      <Nav />

      <div className="mb-6 pt-2">
        <h1 className="text-2xl font-extrabold m-0">Auto-Subscriptions</h1>
        <p className="text-sm text-(--color-text-muted) mt-1 mb-0">
          Automatically queue new videos from YouTube channels, playlists, and your Watch Later
          list.
        </p>
      </div>

      {notice && (
        <div className="mb-4 flex items-center justify-between text-sm font-bold px-4 py-2.5 rounded-lg border-2 border-neon-400 bg-neon-50 dark:bg-neon-950/30 text-neon-700 dark:text-neon-300">
          {notice}
          <button
            onClick={() => setNotice(null)}
            className="bg-transparent border-0 cursor-pointer text-neon-500 hover:text-neon-700 text-lg leading-none ml-2"
          >
            &times;
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-center justify-between text-sm font-bold px-4 py-2.5 rounded-lg border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400">
          {error}
          <button
            onClick={() => setError(null)}
            className="bg-transparent border-0 cursor-pointer text-red-400 hover:text-red-600 text-lg leading-none ml-2"
          >
            &times;
          </button>
        </div>
      )}

      {!isPro && (
        <div className="mb-6 px-4 py-4 border-2 border-amber-300 dark:border-amber-700 rounded-lg bg-(--color-warn-surface) shadow-brutal-sm">
          <p className="text-sm font-bold m-0">Pro feature</p>
          <p className="text-sm text-(--color-text-muted) mt-1 mb-3">
            Auto-subscriptions require a Cliphy Pro plan.
          </p>
          <button
            onClick={async () => {
              try {
                const { url } = await api.createCheckout();
                window.location.href = url;
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to start checkout");
              }
            }}
            className="text-sm font-bold px-4 py-2 bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all"
          >
            Upgrade to Pro
          </button>
        </div>
      )}

      {/* Add channel / playlist */}
      <div className="mb-4 p-4 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm bg-(--color-surface)">
        <h2 className="text-sm font-bold m-0 mb-3">Add Channel or Playlist</h2>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="url"
            value={addUrl}
            onChange={(e) => {
              setAddUrl(e.target.value);
              setAddError(null);
            }}
            placeholder="https://youtube.com/@channel or /playlist?list=…"
            disabled={!isPro || addLoading}
            className="flex-1 text-sm font-medium px-3 py-2 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) text-(--color-text) placeholder:text-(--color-text-faint) outline-none focus:border-neon-500 disabled:opacity-50 transition-colors"
          />
          <button
            type="submit"
            disabled={!isPro || addLoading || !addUrl.trim()}
            className="text-sm font-bold px-4 py-2 bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-brutal-sm"
          >
            {addLoading ? "Adding…" : "Add"}
          </button>
        </form>
        {addError && <p className="mt-2 text-xs font-semibold text-red-500">{addError}</p>}
      </div>

      {/* Watch Later / Google section */}
      <div className="mb-6 p-4 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm bg-(--color-surface)">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold m-0">Watch Later</h2>
            <p className="text-xs text-(--color-text-muted) mt-0.5 mb-0">
              {googleConnected
                ? "Google account connected"
                : "Connect Google to auto-queue your Watch Later list"}
            </p>
          </div>

          {googleConnected ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-bold text-neon-600 dark:text-neon-400">
                Connected ✓
              </span>
              {!hasWatchLater && isPro && (
                <button
                  onClick={handleAddWatchLater}
                  disabled={addLoading}
                  className="text-xs font-bold px-3 py-1.5 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all disabled:opacity-40"
                >
                  Enable
                </button>
              )}
              <button
                onClick={handleDisconnectGoogle}
                disabled={disconnectingGoogle}
                className="text-xs font-bold px-3 py-1.5 border-2 border-red-300 dark:border-red-700 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer transition-colors disabled:opacity-40"
              >
                {disconnectingGoogle ? "…" : "Disconnect"}
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectGoogle}
              disabled={!isPro || connectingGoogle}
              className="shrink-0 text-sm font-bold px-4 py-2 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-brutal-sm"
            >
              {connectingGoogle ? "Redirecting…" : "Connect Google"}
            </button>
          )}
        </div>
      </div>

      {/* Subscriptions list */}
      {subscriptions.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-(--color-border-soft) rounded-lg">
          <p className="text-3xl mb-2">📡</p>
          <p className="text-sm font-bold">No subscriptions yet</p>
          <p className="text-sm text-(--color-text-muted)">
            Add a channel or playlist above to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-xs font-bold text-(--color-text-faint) uppercase tracking-wider mb-2">
            Your subscriptions ({subscriptions.length})
          </h2>
          {subscriptions.map((sub) => (
            <SubscriptionCard
              key={sub.id}
              subscription={sub}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SubscriptionCard({
  subscription: sub,
  onToggle,
  onDelete,
}: {
  subscription: Subscription;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleDeleteClick() {
    if (confirmDelete) {
      onDelete(sub.id);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  }

  return (
    <div className="group flex items-center gap-3 px-4 py-3 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm bg-(--color-surface)">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border-2 ${TYPE_COLORS[sub.type]}`}
          >
            {TYPE_LABELS[sub.type]}
          </span>
          <span className="text-sm font-bold text-(--color-text) truncate">{sub.sourceName}</span>
        </div>
        {sub.lastCheckedAt && (
          <p className="text-[11px] text-(--color-text-faint) mt-0.5 mb-0">
            Checked {relativeDate(sub.lastCheckedAt)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onToggle(sub.id, !sub.isActive)}
          className={`relative w-9 h-5 rounded-full border-2 border-(--color-border-hard) transition-colors cursor-pointer ${
            sub.isActive ? "bg-neon-500" : "bg-(--color-surface-raised)"
          }`}
          title={sub.isActive ? "Pause" : "Resume"}
        >
          <span
            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white border border-black/20 transition-transform ${
              sub.isActive ? "translate-x-[18px]" : "translate-x-0.5"
            }`}
          />
        </button>

        <button
          onClick={handleDeleteClick}
          className={`text-[11px] font-bold px-2 py-1 rounded border cursor-pointer transition-all ${
            confirmDelete
              ? "border-red-400 text-red-600 opacity-100"
              : "border-transparent text-(--color-text-faint) opacity-0 group-hover:opacity-100 hover:text-red-500"
          }`}
        >
          {confirmDelete ? "Delete?" : "✕"}
        </button>
      </div>
    </div>
  );
}
