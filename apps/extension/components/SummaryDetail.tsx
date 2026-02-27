import type { Summary } from "@cliphy/shared";
import { formatTimeSaved, parseDurationToSeconds } from "@cliphy/shared";
import { useState } from "react";

interface SummaryDetailProps {
  summary: Summary;
  onSeek?: (seconds: number) => void;
  onDismiss?: () => void;
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

export function SummaryDetail({ summary, onSeek, onDismiss }: SummaryDetailProps) {
  const [copied, setCopied] = useState<CopyState>("idle");
  const json = summary.summaryJson;

  function scrollToSection(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-indigo-400", "ring-offset-2");
    setTimeout(() => el.classList.remove("ring-2", "ring-indigo-400", "ring-offset-2"), 800);
  }

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
          {/* Inline TOC */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <a
              href="#tldr"
              onClick={(e) => scrollToSection(e, "tldr")}
              className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 no-underline hover:bg-indigo-100 transition-colors"
            >
              TLDR
            </a>
            {json.keyPoints.length > 0 && (
              <a
                href="#key-takeaways"
                onClick={(e) => scrollToSection(e, "key-takeaways")}
                className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600 no-underline hover:bg-gray-200 transition-colors"
              >
                Key Takeaways
              </a>
            )}
            {json.actionItems?.length > 0 && (
              <a
                href="#action-items"
                onClick={(e) => scrollToSection(e, "action-items")}
                className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600 no-underline hover:bg-gray-200 transition-colors"
              >
                Action Items
              </a>
            )}
            {json.timestamps.length > 0 && (
              <a
                href="#timestamps"
                onClick={(e) => scrollToSection(e, "timestamps")}
                className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600 no-underline hover:bg-gray-200 transition-colors"
              >
                Timestamps
              </a>
            )}
          </div>

          {/* Summary / TL;DR */}
          <div id="tldr" className="bg-indigo-50 rounded-lg p-3 mb-4 transition-all duration-300">
            <h3 className="text-xs font-bold uppercase tracking-wide text-indigo-600 m-0 mb-1.5">
              TLDR
            </h3>
            <p className="text-sm text-gray-800 leading-relaxed m-0">{json.summary}</p>
          </div>

          {/* Key Points */}
          {json.keyPoints.length > 0 && (
            <div id="key-takeaways" className="mb-4 rounded-lg transition-all duration-300">
              <h3 className="text-xs font-bold uppercase tracking-wide text-indigo-600 bg-indigo-50 inline-block px-2 py-0.5 rounded m-0 mb-2">
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
            <div id="action-items" className="mb-4 rounded-lg transition-all duration-300">
              <h3 className="text-xs font-bold uppercase tracking-wide text-indigo-600 bg-indigo-50 inline-block px-2 py-0.5 rounded m-0 mb-2">
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
            <div id="timestamps" className="mb-4 rounded-lg transition-all duration-300">
              <h3 className="text-xs font-bold uppercase tracking-wide text-indigo-600 bg-indigo-50 inline-block px-2 py-0.5 rounded m-0 mb-2">
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
                            className="w-10 text-right text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer p-0 font-mono text-xs font-bold shrink-0 transition-colors"
                          >
                            {parsed.time}
                          </button>
                        ) : (
                          <a
                            href={`https://youtube.com/watch?v=${summary.videoId}&t=${parsed.seconds}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-10 text-right text-indigo-600 hover:text-indigo-800 font-mono text-xs font-bold shrink-0 no-underline transition-colors inline-block"
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
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="ml-auto text-xs px-2 py-1.5 bg-white border-2 border-black rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all text-gray-400 hover:text-red-500"
                title="Dismiss summary"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
