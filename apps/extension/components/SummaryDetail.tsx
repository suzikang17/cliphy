import type { Summary } from "@cliphy/shared";
import { formatTimeSaved, parseDurationToSeconds } from "@cliphy/shared";
import { useState } from "react";

interface SummaryDetailProps {
  summary: Summary;
  onSeek?: (seconds: number) => void;
}

function extractTimestamp(text: string): { time: string; seconds: number; label: string } | null {
  const match = text.match(/^[[(\s]*(\d{1,2}:\d{2}(?::\d{2})?)[)\]\s]*[-\u2013\u2014:\s]*(.*)/);
  if (!match) return null;
  const time = match[1];
  const seconds = parseDurationToSeconds(time);
  if (seconds === null) return null;
  return { time, seconds, label: match[2].trim() || time };
}

function toMarkdown(summary: Summary): string {
  const json = summary.summaryJson;
  if (!json) return "";
  const lines: string[] = [];
  lines.push(`# ${summary.videoTitle || summary.videoId}`);
  if (summary.videoChannel) lines.push(`**${summary.videoChannel}**`);
  if (json.description) lines.push(`*${json.description}*`);
  lines.push("");
  lines.push("## Summary");
  lines.push(json.summary);
  lines.push("");
  if (json.keyPoints.length > 0) {
    lines.push("## Key Takeaways");
    for (const point of json.keyPoints) {
      lines.push(`- ${point}`);
    }
    lines.push("");
  }
  if (json.actionItems?.length > 0) {
    lines.push("## Action Items");
    for (const item of json.actionItems) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  if (json.timestamps.length > 0) {
    lines.push("## Timestamps");
    for (const ts of json.timestamps) {
      const parsed = extractTimestamp(ts);
      if (parsed && summary.videoId) {
        lines.push(
          `- [${parsed.time}](https://youtube.com/watch?v=${summary.videoId}&t=${parsed.seconds}) ${parsed.label}`,
        );
      } else {
        lines.push(`- ${ts}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function toPlainText(summary: Summary): string {
  const json = summary.summaryJson;
  if (!json) return "";
  const lines: string[] = [];
  lines.push(summary.videoTitle || summary.videoId);
  if (summary.videoChannel) lines.push(summary.videoChannel);
  if (json.description) lines.push(json.description);
  lines.push("");
  lines.push("Summary:");
  lines.push(json.summary);
  lines.push("");
  if (json.keyPoints.length > 0) {
    lines.push("Key Takeaways:");
    for (const point of json.keyPoints) {
      lines.push(`• ${point}`);
    }
    lines.push("");
  }
  if (json.actionItems?.length > 0) {
    lines.push("Action Items:");
    for (const item of json.actionItems) {
      lines.push(`→ ${item}`);
    }
    lines.push("");
  }
  if (json.timestamps.length > 0) {
    lines.push("Timestamps:");
    for (const ts of json.timestamps) {
      lines.push(`• ${ts}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

type CopyState = "idle" | "markdown" | "text";

export function SummaryDetail({ summary, onSeek }: SummaryDetailProps) {
  const [copied, setCopied] = useState<CopyState>("idle");
  const json = summary.summaryJson;

  async function handleCopy(format: "markdown" | "text") {
    const content = format === "markdown" ? toMarkdown(summary) : toPlainText(summary);
    try {
      await navigator.clipboard.writeText(content);
      setCopied(format);
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      // Clipboard API can fail in extension contexts
    }
  }

  return (
    <div>
      {/* Video metadata */}
      <div className="flex gap-3 mb-4">
        <img
          src={`https://i.ytimg.com/vi/${summary.videoId}/mqdefault.jpg`}
          alt=""
          className="w-24 h-auto rounded-lg border-2 border-black object-cover shrink-0"
        />
        <div className="min-w-0">
          <h2 className="text-base font-extrabold leading-snug m-0">
            {summary.videoTitle || summary.videoId}
          </h2>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
            {summary.videoChannel && <span>{summary.videoChannel}</span>}
            {summary.videoChannel && summary.videoDurationSeconds && <span>&middot;</span>}
            {summary.videoDurationSeconds != null && summary.videoDurationSeconds > 0 && (
              <span>{formatTimeSaved(summary.videoDurationSeconds)}</span>
            )}
          </div>
        </div>
      </div>

      {!json ? (
        <p className="text-gray-500 text-sm">No summary data available.</p>
      ) : (
        <>
          {/* One-line description */}
          {json.description && (
            <p className="text-sm text-gray-500 italic mb-4 m-0">{json.description}</p>
          )}

          {/* Summary / TL;DR */}
          <div className="bg-indigo-50 border-2 border-black rounded-lg p-3 mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-indigo-600 m-0 mb-1.5">
              TL;DR
            </h3>
            <p className="text-sm text-gray-800 leading-relaxed m-0">{json.summary}</p>
          </div>

          {/* Key Points */}
          {json.keyPoints.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 m-0 mb-2">
                Key Takeaways
              </h3>
              <ul className="list-none p-0 m-0 space-y-1.5">
                {json.keyPoints.map((point, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-800">
                    <span className="text-indigo-500 font-bold shrink-0">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Items */}
          {json.actionItems?.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 m-0 mb-2">
                Action Items
              </h3>
              <ul className="list-none p-0 m-0 space-y-1.5">
                {json.actionItems.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-800">
                    <span className="text-green-600 font-bold shrink-0">→</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Timestamps */}
          {json.timestamps.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 m-0 mb-2">
                Timestamps
              </h3>
              <ul className="list-none p-0 m-0 space-y-1">
                {json.timestamps.map((ts, i) => {
                  const parsed = extractTimestamp(ts);
                  if (parsed) {
                    return (
                      <li key={i} className="flex items-baseline gap-2 text-sm">
                        {onSeek ? (
                          <button
                            onClick={() => onSeek(parsed.seconds)}
                            className="text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer p-0 font-mono text-xs font-bold shrink-0 transition-colors"
                          >
                            {parsed.time}
                          </button>
                        ) : (
                          <a
                            href={`https://youtube.com/watch?v=${summary.videoId}&t=${parsed.seconds}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:text-indigo-800 font-mono text-xs font-bold shrink-0 no-underline transition-colors"
                          >
                            {parsed.time}
                          </a>
                        )}
                        <span className="text-gray-700">{parsed.label}</span>
                      </li>
                    );
                  }
                  return (
                    <li key={i} className="text-sm text-gray-800">
                      {ts}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Export buttons */}
          <div className="flex gap-2 pt-2 border-t border-gray-200">
            <button
              onClick={() => handleCopy("markdown")}
              className="text-xs font-bold px-3 py-1.5 bg-white border-2 border-black rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all"
            >
              {copied === "markdown" ? "Copied!" : "Copy Markdown"}
            </button>
            <button
              onClick={() => handleCopy("text")}
              className="text-xs font-bold px-3 py-1.5 bg-white border-2 border-black rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all"
            >
              {copied === "text" ? "Copied!" : "Copy Text"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
