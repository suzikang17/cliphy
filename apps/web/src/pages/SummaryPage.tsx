import type { Summary } from "@cliphy/shared";
import { formatTimeSaved, parseDurationToSeconds } from "@cliphy/shared";
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getSummary(id)
      .then((res) => setSummary(res.summary))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

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

      {/* Back link */}
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1 text-sm font-semibold text-(--color-text-muted) hover:text-neon-600 no-underline transition-colors mb-6"
      >
        &larr; Dashboard
      </Link>

      {/* Video metadata */}
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
          {summary.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {summary.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border-2 border-(--color-border-soft)"
                >
                  {tag}
                </span>
              ))}
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

          {/* TL;DR */}
          <section className="bg-(--color-surface-raised) rounded-xl p-5">
            <h2 className="text-xs font-bold uppercase tracking-wide text-neon-600 mb-2">TL;DR</h2>
            <p className="text-base text-(--color-text-body) leading-relaxed m-0 italic">
              {json.summary}
            </p>
          </section>

          {/* Key Points */}
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

          {/* Timestamps */}
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

          {/* Context Section */}
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
