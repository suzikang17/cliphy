import type { Summary, UsageInfo } from "@cliphy/shared";
import { useEffect, useState } from "react";
import { Nav } from "../components/Nav";
import { SummaryCard } from "../components/SummaryCard";
import { UsageBar } from "../components/UsageBar";
import * as api from "../lib/api";

export function Dashboard() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [queueRes, summariesRes, usageRes] = await Promise.all([
          api.getQueue(),
          api.getSummaries(),
          api.getUsage(),
        ]);

        // Merge queue items and completed summaries, dedup by id
        const all = new Map<string, Summary>();
        for (const s of queueRes.items) all.set(s.id, s);
        for (const s of summariesRes.summaries) all.set(s.id, s);

        const merged = Array.from(all.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        setSummaries(merged);
        setUsage(usageRes.usage);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleUpgrade() {
    setUpgradeLoading(true);
    try {
      const { url } = await api.createCheckout();
      window.location.href = url;
    } catch {
      setUpgradeLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6">
      <Nav />

      <h1 className="text-2xl font-bold tracking-tight mb-4">Your Summaries</h1>

      {/* Usage */}
      {usage && (
        <div className="mb-6">
          <UsageBar usage={usage} onUpgrade={handleUpgrade} upgradeLoading={upgradeLoading} />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-3 border-neon-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      ) : summaries.length === 0 ? (
        <div className="text-center py-16 border-2 border-(--color-border-hard) rounded-xl shadow-brutal-sm bg-(--color-surface)">
          <p className="text-3xl mb-3">🎬</p>
          <p className="text-base font-bold mb-1">No summaries yet</p>
          <p className="text-sm text-(--color-text-muted)">
            Install the Chrome extension to start queuing YouTube videos.
          </p>
        </div>
      ) : (
        <div className="space-y-3 pb-8">
          {summaries.map((s) => (
            <SummaryCard key={s.id} summary={s} />
          ))}
        </div>
      )}
    </div>
  );
}
