import type { AutoTagSuggestion, Summary } from "@cliphy/shared";
import { TagSuggestions, formatTimeSaved, parseDurationToSeconds } from "@cliphy/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Nav } from "../components/Nav";
import * as api from "../lib/api";

function extractTimestamp(text: string): { time: string; seconds: number; label: string } | null {
  const match = text.match(/^[[(\s]*(\d{1,2}:\d{2}(?::\d{2})?)[)\]\s]*[-\u2013\u2014:\s]*(.*)/);
  if (!match) return null;
  const time = match[1];
  const seconds = parseDurationToSeconds(time);
  if (seconds === null) return null;
  return { time, seconds, label: match[2].trim() || time };
}

export function SummaryPage() {
  const { id } = useParams<{ id: string }>();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [autoTagResult, setAutoTagResult] = useState<AutoTagSuggestion | null>(null);
  const [autoTagLoading, setAutoTagLoading] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.getSummary(id),
      api.getAllTags().catch(() => ({ tags: [] as string[] })),
      api.getUsage().catch(() => null),
    ])
      .then(([res, tagsRes, usageRes]) => {
        setSummary(res.summary);
        setAllTags(tagsRes.tags);
        if (usageRes) setIsPro(usageRes.usage.plan === "pro");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!showTagPicker) return;
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowTagPicker(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showTagPicker]);

  async function handleTagsChange(newTags: string[]) {
    if (!summary || !id) return;
    const rollback = summary.tags;
    setSummary((prev) => (prev ? { ...prev, tags: newTags } : prev));
    try {
      const res = await api.updateSummaryTags(id, newTags);
      setSummary((prev) => (prev ? { ...prev, tags: res.tags } : prev));
      const tagsRes = await api.getAllTags().catch(() => null);
      if (tagsRes) setAllTags(tagsRes.tags);
    } catch {
      setSummary((prev) => (prev ? { ...prev, tags: rollback } : prev));
    }
  }

  async function handleRetry() {
    if (!id) return;
    setRetrying(true);
    try {
      await api.retryQueueItem(id);
      setSummary((prev) => (prev ? { ...prev, status: "pending", summaryJson: undefined } : prev));
      const interval = setInterval(async () => {
        try {
          const res = await api.getSummary(id);
          setSummary(res.summary);
          if (res.summary.status === "completed" || res.summary.status === "failed") {
            clearInterval(interval);
            setRetrying(false);
          }
        } catch {
          clearInterval(interval);
          setRetrying(false);
        }
      }, 3000);
    } catch {
      setRetrying(false);
    }
  }

  async function handleAutoTag() {
    if (!id) return;
    setAutoTagLoading(true);
    try {
      const result = await api.autoTagSummary(id);
      setAutoTagResult(result);
    } catch (err) {
      console.error("Auto-tag failed:", err);
    } finally {
      setAutoTagLoading(false);
    }
  }

  function handleAutoTagApplyOne(tag: string) {
    if (!summary) return;
    handleTagsChange([...summary.tags, tag]);
    setAutoTagResult((prev) => {
      if (!prev) return null;
      const remaining = {
        existing: prev.existing.filter((t) => t !== tag),
        new: prev.new.filter((t) => t !== tag),
      };
      return remaining.existing.length === 0 && remaining.new.length === 0 ? null : remaining;
    });
  }

  function handleAutoTagApplyAll(tags: string[]) {
    if (!summary) return;
    handleTagsChange([...summary.tags, ...tags]);
    setAutoTagResult(null);
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6">
        <Nav />
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-3 border-neon-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="max-w-3xl mx-auto px-6">
        <Nav />
        <div className="text-center py-16">
          <p className="text-sm text-red-600 dark:text-red-400">{error || "Summary not found"}</p>
          <Link
            to="/dashboard"
            className="inline-block mt-4 text-sm font-semibold text-neon-600 hover:underline"
          >
            &larr; Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const json = summary.summaryJson;
  const ctx =
    json?.contextSection ??
    (json?.actionItems?.length
      ? { title: "Action Items", icon: "→", items: json.actionItems, groups: undefined }
      : null);

  return (
    <div className="max-w-3xl mx-auto px-6 pb-12">
      <Nav />

      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1 text-sm font-semibold text-(--color-text-muted) hover:text-neon-600 no-underline transition-colors mb-6"
      >
        &larr; Dashboard
      </Link>

      {/* Video metadata + tag editing */}
      <div className="flex items-start gap-4 mb-8">
        <a
          href={`https://youtube.com/watch?v=${summary.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
        >
          <img
            src={`https://i.ytimg.com/vi/${summary.videoId}/hqdefault.jpg`}
            alt=""
            className="w-48 h-auto rounded-xl border-2 border-(--color-border-hard) shadow-brutal-sm object-cover hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
          />
        </a>
        <div className="min-w-0">
          <a
            href={`https://youtube.com/watch?v=${summary.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline text-(--color-text)"
          >
            <h1 className="text-xl font-bold leading-snug m-0 hover:text-neon-600 transition-colors">
              {summary.videoTitle || summary.videoId}
            </h1>
          </a>
          <div className="flex items-center gap-2 text-sm text-(--color-text-muted) mt-1.5">
            {summary.videoChannel && <span>{summary.videoChannel}</span>}
            {summary.videoDurationSeconds != null && summary.videoDurationSeconds > 0 && (
              <>
                <span>&middot;</span>
                <span>{formatTimeSaved(summary.videoDurationSeconds)}</span>
              </>
            )}
          </div>

          {/* Tags + editing */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {summary.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border-2 border-(--color-border-soft)"
              >
                {tag}
                <button
                  onClick={() => handleTagsChange(summary.tags.filter((t) => t !== tag))}
                  className="bg-transparent border-0 p-0 cursor-pointer text-neon-500 hover:text-red-500 transition-colors leading-none"
                  title={`Remove "${tag}"`}
                >
                  &times;
                </button>
              </span>
            ))}
            <div className="relative" ref={pickerRef}>
              <button
                onClick={() => setShowTagPicker((v) => !v)}
                className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border-2 border-(--color-border-soft) hover:border-neon-300 hover:text-neon-600 cursor-pointer transition-colors"
              >
                + tag
              </button>
              {showTagPicker && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm py-1 min-w-[140px]">
                  {allTags.filter((t) => !summary.tags.includes(t)).length > 0 ? (
                    allTags
                      .filter((t) => !summary.tags.includes(t))
                      .map((t) => (
                        <button
                          key={t}
                          onClick={() => {
                            handleTagsChange([...summary.tags, t]);
                            setShowTagPicker(false);
                          }}
                          className="w-full text-left text-xs font-bold px-3 py-1.5 bg-transparent border-0 cursor-pointer text-(--color-text-secondary) hover:bg-neon-100 hover:text-neon-600 dark:hover:bg-neon-900/30 dark:hover:text-neon-300 transition-colors"
                        >
                          {t}
                        </button>
                      ))
                  ) : (
                    <span className="block text-xs text-(--color-text-faint) px-3 py-1.5">
                      No more tags
                    </span>
                  )}
                </div>
              )}
            </div>

            {isPro && !autoTagResult && json && (
              <button
                onClick={handleAutoTag}
                disabled={autoTagLoading}
                className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-neon-100 dark:bg-neon-900/30 text-neon-700 dark:text-neon-400 border-2 border-neon-300 dark:border-neon-700 hover:bg-neon-200 dark:hover:bg-neon-900/50 cursor-pointer transition-colors disabled:opacity-50"
              >
                {autoTagLoading ? "..." : "✨ Auto-tag"}
              </button>
            )}
          </div>

          {autoTagResult && (
            <div className="mt-2">
              <TagSuggestions
                existing={autoTagResult.existing}
                new={autoTagResult.new}
                currentTags={summary.tags}
                onApplyOne={handleAutoTagApplyOne}
                onApply={handleAutoTagApplyAll}
                onDismiss={() => setAutoTagResult(null)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Summary content */}
      {!json ? (
        summary.status === "pending" || summary.status === "processing" ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-8 h-8 border-3 border-neon-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-(--color-text-muted)">
              {summary.status === "pending" ? "Queued..." : "Generating summary..."}
            </p>
          </div>
        ) : summary.status === "failed" ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-sm text-red-600 dark:text-red-400">Summary generation failed.</p>
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="text-sm font-bold px-4 py-2 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer disabled:opacity-50 transition-all"
            >
              {retrying ? "Retrying..." : "Retry"}
            </button>
          </div>
        ) : (
          <p className="text-(--color-text-muted)">No summary data available.</p>
        )
      ) : (
        <div className="space-y-5">
          {json.truncated && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              This summary is based on a partial transcript. The video was too long to process in
              full.
            </div>
          )}

          <section className="bg-(--color-surface-raised) rounded-xl p-5">
            <h2 className="text-xs font-bold uppercase tracking-wide text-neon-600 mb-2">TL;DR</h2>
            <p className="text-base text-(--color-text-body) leading-relaxed m-0 italic">
              {json.summary}
            </p>
          </section>

          {json.keyPoints.length > 0 && (
            <section className="bg-(--color-surface-raised) rounded-xl p-5">
              <h2 className="text-xs font-bold uppercase tracking-wide text-neon-600 mb-2">
                Highlights
              </h2>
              <ul className="list-none p-0 m-0 space-y-2">
                {json.keyPoints.map((point, i) => (
                  <li key={i} className="flex gap-2 text-sm text-(--color-text-body)">
                    <span className="text-neon-500 font-bold shrink-0">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {json.timestamps.length > 0 && (
            <section className="bg-(--color-surface-raised) rounded-xl p-5">
              <h2 className="text-xs font-bold uppercase tracking-wide text-neon-600 mb-2">
                Jump To
              </h2>
              <ul className="list-none p-0 m-0 space-y-1.5">
                {json.timestamps.map((ts, i) => {
                  const parsed = extractTimestamp(ts);
                  if (parsed) {
                    return (
                      <li key={i} className="flex items-baseline gap-3 text-sm">
                        <a
                          href={`https://youtube.com/watch?v=${summary.videoId}&t=${parsed.seconds}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-16 text-right text-neon-600 hover:text-neon-800 font-mono text-xs font-bold shrink-0 no-underline transition-colors"
                        >
                          {parsed.time}
                        </a>
                        <span className="text-(--color-text-body)">{parsed.label}</span>
                      </li>
                    );
                  }
                  return (
                    <li key={i} className="text-sm text-(--color-text-body)">
                      {ts}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {ctx && (
            <section className="bg-(--color-surface-raised) rounded-xl p-5">
              <h2 className="text-xs font-bold uppercase tracking-wide text-neon-600 mb-2">
                {ctx.title}
              </h2>
              {ctx.groups?.length ? (
                <div className="space-y-4">
                  {ctx.groups.map((group, gi) => (
                    <div key={gi}>
                      <h3 className="text-xs font-semibold text-(--color-text-secondary) uppercase tracking-wide mb-1">
                        {group.label}
                      </h3>
                      <ul className="list-none p-0 m-0 space-y-1.5">
                        {group.items.map((item, i) => (
                          <li key={i} className="flex gap-2 text-sm text-(--color-text-body)">
                            <span className="text-neon-500 font-bold shrink-0">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="list-none p-0 m-0 space-y-1.5">
                  {ctx.items.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm text-(--color-text-body)">
                      <span className="text-neon-500 font-bold shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
