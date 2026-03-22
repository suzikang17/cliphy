import type {
  ChatMessage,
  ChatResponse,
  ContextSection,
  Summary,
  SummaryJson,
} from "@cliphy/shared";
import { formatTimeSaved, parseDurationToSeconds, TAG_MAX_LENGTH } from "@cliphy/shared";
import { useEffect, useRef, useState } from "react";
import { ChatThread } from "./ChatThread";

interface SummaryDetailProps {
  summary: Summary;
  allTags?: string[];
  tagLimitReached?: boolean;
  onTagsChange?: (tags: string[]) => void;
  onSeek?: (seconds: number) => void;
  onDismiss?: () => void;
  /** Re-summarize this video (retry with fresh AI call) */
  onRetry?: () => void;
  /** Open summary in a new tab (popout) */
  onOpenInTab?: () => void;
  /** When true, export bar is not rendered inline — use ExportBar separately */
  pinned?: boolean;
  /** External markdown toggle (used when pinned) */
  copyAsMarkdown?: boolean;
  /** Chat with AI about this video (Pro-only) */
  onChat?: (messages: ChatMessage[]) => Promise<ChatResponse>;
  /** Apply a summary update from chat */
  onApplyUpdate?: (summaryJson: SummaryJson) => Promise<void>;
  /** Whether this summary has a transcript for chat */
  hasTranscript?: boolean;
  /** Called when active tab changes (for parent layout adjustments) */
  onTabChange?: (tab: "summary" | "chat") => void;
}

export { ExportBar, toMarkdown, toPlainText };

function extractTimestamp(text: string): { time: string; seconds: number; label: string } | null {
  const match = text.match(/^[[(\s]*(\d{1,2}:\d{2}(?::\d{2})?)[)\]\s]*[-\u2013\u2014:\s]*(.*)/);
  if (!match) return null;
  const time = match[1];
  const seconds = parseDurationToSeconds(time);
  if (seconds === null) return null;
  return { time, seconds, label: match[2].trim() || time };
}

/** Resolve contextSection from new or legacy format */
function resolveContextSection(json: NonNullable<Summary["summaryJson"]>): ContextSection | null {
  if (json.contextSection) return json.contextSection;
  if (json.actionItems && json.actionItems.length > 0) {
    return { title: "Action Items", icon: "→", items: json.actionItems };
  }
  return null;
}

function toMarkdown(summary: Summary): string {
  const json = summary.summaryJson;
  if (!json) return "";
  const lines: string[] = [];
  lines.push(`# ${summary.videoTitle || summary.videoId}`);
  if (summary.videoChannel) lines.push(`**${summary.videoChannel}**`);
  lines.push("");
  lines.push("## TL;DR");
  lines.push(json.summary);
  lines.push("");
  if (json.keyPoints.length > 0) {
    lines.push("## Highlights");
    for (const point of json.keyPoints) {
      lines.push(`- ${point}`);
    }
    lines.push("");
  }
  const ctxMd = resolveContextSection(json);
  if (ctxMd) {
    lines.push(`## ${ctxMd.title}`);
    if (ctxMd.groups?.length) {
      for (const group of ctxMd.groups) {
        lines.push(`### ${group.label}`);
        for (const item of group.items) lines.push(`- ${item}`);
        lines.push("");
      }
    } else {
      for (const item of ctxMd.items) lines.push(`- ${item}`);
      lines.push("");
    }
  }
  if (json.timestamps.length > 0) {
    lines.push("## Jump To");
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
  lines.push("TL;DR:");
  lines.push(json.summary);
  lines.push("");
  if (json.keyPoints.length > 0) {
    lines.push("Highlights:");
    for (const point of json.keyPoints) {
      lines.push(`• ${point}`);
    }
    lines.push("");
  }
  const ctxPt = resolveContextSection(json);
  if (ctxPt) {
    lines.push(`${ctxPt.title}:`);
    if (ctxPt.groups?.length) {
      for (const group of ctxPt.groups) {
        lines.push(`${group.label}:`);
        for (const item of group.items) lines.push(`• ${item}`);
        lines.push("");
      }
    } else {
      for (const item of ctxPt.items) lines.push(`• ${item}`);
      lines.push("");
    }
  }
  if (json.timestamps.length > 0) {
    lines.push("Jump To:");
    for (const ts of json.timestamps) {
      lines.push(`• ${ts}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function TagEditor({
  tags,
  allTags,
  tagLimitReached,
  onChange,
}: {
  tags: string[];
  allTags: string[];
  tagLimitReached: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleAdd() {
    const tag = input.toLowerCase().trim();
    if (!tag || tag.length > TAG_MAX_LENGTH || tags.includes(tag)) {
      setInput("");
      setAdding(false);
      return;
    }
    onChange([...tags, tag]);
    setInput("");
    setAdding(false);
  }

  function handleRemove(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    } else if (e.key === "Escape") {
      setInput("");
      setAdding(false);
    }
  }

  // Filter suggestions: tags the user has used before but aren't on this summary
  const suggestions = allTags.filter((t) => !tags.includes(t));

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border-2 border-(--color-border-soft)"
        >
          {tag}
          <button
            onClick={() => handleRemove(tag)}
            className="bg-transparent border-0 p-0 cursor-pointer text-neon-500 hover:text-red-500 transition-colors leading-none"
            title={`Remove "${tag}"`}
          >
            &times;
          </button>
        </span>
      ))}
      {adding ? (
        <div className="relative inline-flex flex-col">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              setTimeout(() => handleAdd(), 150);
            }}
            maxLength={TAG_MAX_LENGTH}
            placeholder="tag name"
            className="text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-neon-400 bg-(--color-surface) text-(--color-text) outline-none w-24"
            autoFocus
          />
          {(() => {
            const q = input.toLowerCase().trim();
            const filtered = suggestions.filter((t) => !q || t.includes(q));
            return filtered.length > 0 ? (
              <div className="absolute top-full left-0 mt-1 z-50 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm py-1 min-w-[120px]">
                {filtered.map((t) => (
                  <button
                    key={t}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange([...tags, t]);
                      setInput("");
                      setAdding(false);
                    }}
                    className="w-full text-left text-[11px] font-bold px-3 py-1.5 bg-transparent border-0 cursor-pointer text-(--color-text-secondary) hover:bg-neon-100 hover:text-neon-600 dark:hover:bg-neon-900/30 dark:hover:text-neon-300 transition-colors"
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null;
          })()}
        </div>
      ) : tagLimitReached ? (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">
          Upgrade for more tags
        </span>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border-2 border-(--color-border-soft) hover:border-neon-300 hover:text-neon-600 cursor-pointer transition-colors"
          title="Add tag"
        >
          + tag
        </button>
      )}
    </div>
  );
}

function ExportBar({
  copied,
  copyMarkdown,
  setCopyMarkdown,
  onCopy,
  onRetry,
  onDismiss,
}: {
  copied: CopyState;
  copyMarkdown: boolean;
  setCopyMarkdown: (v: boolean) => void;
  onCopy: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const [confirmRetry, setConfirmRetry] = useState(false);

  function handleRetryClick() {
    if (confirmRetry) {
      onRetry?.();
      setConfirmRetry(false);
    } else {
      setConfirmRetry(true);
      setTimeout(() => setConfirmRetry(false), 3000);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onCopy}
        className="text-xs font-bold px-3 py-1.5 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed hover:bg-neon-100 hover:text-neon-600 dark:hover:bg-neon-900/30 dark:hover:text-neon-300 press-down cursor-pointer transition-all"
      >
        {copied === "copied" ? "Copied!" : "Copy All"}
      </button>
      <label className="flex items-center gap-1.5 text-[11px] text-(--color-text-secondary) cursor-pointer select-none -mb-0.5">
        <input
          type="checkbox"
          checked={copyMarkdown}
          onChange={(e) => setCopyMarkdown(e.target.checked)}
          className="accent-neon-600 cursor-pointer"
        />
        Markdown
      </label>
      <div className="ml-auto flex items-center gap-2">
        {onRetry && (
          <button
            onClick={handleRetryClick}
            className={`text-xs px-2 py-1.5 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all ${
              confirmRetry
                ? "text-amber-600 border-amber-400 font-bold"
                : "text-(--color-text-faint) hover:text-neon-600 hover:bg-neon-50 dark:hover:bg-neon-900/30"
            }`}
            title="Re-summarize this video"
          >
            {confirmRetry ? (
              "Re-summarize?"
            ) : (
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
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            )}
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-xs px-2 py-1.5 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed hover:bg-red-50 dark:hover:bg-red-950/30 press-down cursor-pointer transition-all text-(--color-text-faint) hover:text-red-500"
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
    </div>
  );
}

function CopyButton({
  text,
  markdownText,
  useMarkdown,
}: {
  text: string;
  markdownText?: string;
  useMarkdown?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(useMarkdown && markdownText ? markdownText : text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in extension contexts
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="text-(--color-text-faint) hover:text-neon-600 bg-transparent hover:bg-neon-100 dark:hover:bg-neon-900/30 border-0 p-1 -m-1 rounded cursor-pointer transition-all"
      title="Copy section"
    >
      {copied ? (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-neon-600"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

type CopyState = "idle" | "copied";

export function SummaryDetail({
  summary,
  allTags,
  tagLimitReached,
  onTagsChange,
  onSeek,
  onDismiss,
  onRetry,
  onOpenInTab,
  pinned,
  copyAsMarkdown,
  onChat,
  onApplyUpdate,
  hasTranscript,
  onTabChange,
}: SummaryDetailProps) {
  const [copied, setCopied] = useState<CopyState>("idle");
  const [localCopyMarkdown, setLocalCopyMarkdown] = useState(false);
  const [activeTab, setActiveTab] = useState<"summary" | "chat">("summary");

  useEffect(() => {
    onTabChange?.(activeTab);
  }, [activeTab]);
  const [summaryUpdated, setSummaryUpdated] = useState(false);
  const copyMarkdown = pinned ? (copyAsMarkdown ?? false) : localCopyMarkdown;
  const json = summary.summaryJson;

  function scrollToSection(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-neon-400", "ring-offset-2");
    setTimeout(() => el.classList.remove("ring-2", "ring-neon-400", "ring-offset-2"), 800);
  }

  async function handleCopy() {
    const content = copyMarkdown ? toMarkdown(summary) : toPlainText(summary);
    try {
      await navigator.clipboard.writeText(content);
      setCopied("copied");
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      // Clipboard API can fail in extension contexts
    }
  }

  return (
    <div className={activeTab === "chat" && onChat ? "flex flex-col h-full px-4 pt-4" : ""}>
      {/* Video metadata */}
      <div className={`flex items-start gap-3 ${activeTab === "chat" ? "mb-2" : "mb-4"}`}>
        <a
          href={`https://youtube.com/watch?v=${summary.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
        >
          <img
            src={`https://i.ytimg.com/vi/${summary.videoId}/mqdefault.jpg`}
            alt=""
            className="w-28 h-auto rounded-lg border-2 border-(--color-border-hard) object-cover hover:shadow-brutal-sm hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all"
          />
        </a>
        <div className="min-w-0">
          <a
            href={`https://youtube.com/watch?v=${summary.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline text-(--color-text)"
          >
            <h2 className="text-sm font-extrabold leading-snug m-0 hover:text-neon-600 transition-colors">
              {summary.videoTitle || summary.videoId}
            </h2>
          </a>
          <div className="flex items-center gap-1.5 text-xs text-(--color-text-muted) mt-1">
            {summary.videoChannel && (
              <a
                href={`https://youtube.com/results?search_query=${encodeURIComponent(summary.videoChannel)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-(--color-text-muted) hover:text-neon-600 no-underline transition-colors"
              >
                {summary.videoChannel}
              </a>
            )}
            {summary.videoChannel && summary.videoDurationSeconds && <span>&middot;</span>}
            {summary.videoDurationSeconds != null && summary.videoDurationSeconds > 0 && (
              <span>{formatTimeSaved(summary.videoDurationSeconds)}</span>
            )}
            {onOpenInTab && (
              <>
                <span>&middot;</span>
                <button
                  onClick={onOpenInTab}
                  className="inline-flex items-center gap-1 text-xs text-(--color-text-muted) hover:text-neon-600 bg-transparent border-0 cursor-pointer p-0 transition-colors"
                  title="View in Cliphub"
                >
                  View in Cliphub
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </button>
              </>
            )}
          </div>
          {/* Tags */}
          {onTagsChange && (
            <TagEditor
              tags={summary.tags}
              allTags={allTags ?? []}
              tagLimitReached={tagLimitReached ?? false}
              onChange={onTagsChange}
            />
          )}
        </div>
      </div>

      {/* Tab bar — only when chat is available and summary has content */}
      {onChat && json && (
        <div className="flex border-b-2 border-(--color-border-soft) mb-3">
          <button
            onClick={() => setActiveTab("summary")}
            className={`flex-1 py-2 text-xs font-bold text-center -mb-[2px] border-b-2 transition-colors cursor-pointer ${
              activeTab === "summary"
                ? "border-neon-600 text-neon-600 dark:text-neon-400"
                : "border-transparent text-(--color-text-faint) hover:text-(--color-text)"
            }`}
          >
            Summary
            {summaryUpdated && activeTab !== "summary" && (
              <span className="inline-block w-1.5 h-1.5 bg-neon-600 rounded-full ml-1.5 -mt-1" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex-1 py-2 text-xs font-bold text-center -mb-[2px] border-b-2 transition-colors cursor-pointer ${
              activeTab === "chat"
                ? "border-neon-600 text-neon-600 dark:text-neon-400"
                : "border-transparent text-(--color-text-faint) hover:text-(--color-text)"
            }`}
          >
            💬 Chat
          </button>
        </div>
      )}

      {!json ? (
        summary.status === "pending" || summary.status === "processing" ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="w-6 h-6 border-2 border-neon-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-(--color-text-muted) m-0">
              {summary.status === "pending" ? "Queued..." : "Generating summary..."}
            </p>
          </div>
        ) : (
          <p className="text-(--color-text-muted) text-sm">No summary data available.</p>
        )
      ) : (
        <>
          {activeTab === "summary" && (
            <>
              {/* Truncation warning */}
              {json.truncated && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded-lg px-3 py-2 mb-4 text-xs text-amber-700 dark:text-amber-400">
                  This summary is based on a partial transcript. The video was too long to process
                  in full.
                </div>
              )}

              {/* Inline TOC */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                <a
                  href="#tldr"
                  onClick={(e) => scrollToSection(e, "tldr")}
                  className="text-[10px] font-bold px-2 py-0.5 rounded bg-(--color-surface-raised) text-(--color-text-secondary) no-underline hover:bg-neon-100 hover:text-neon-600 dark:hover:bg-neon-900/30 dark:hover:text-neon-300 transition-colors cursor-pointer"
                >
                  TL;DR
                </a>
                {json.keyPoints.length > 0 && (
                  <a
                    href="#highlights"
                    onClick={(e) => scrollToSection(e, "highlights")}
                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-(--color-surface-raised) text-(--color-text-secondary) no-underline hover:bg-neon-100 hover:text-neon-600 dark:hover:bg-neon-900/30 dark:hover:text-neon-300 transition-colors cursor-pointer"
                  >
                    Highlights
                  </a>
                )}
                {json.timestamps.length > 0 && (
                  <a
                    href="#jump-to"
                    onClick={(e) => scrollToSection(e, "jump-to")}
                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-(--color-surface-raised) text-(--color-text-secondary) no-underline hover:bg-neon-100 hover:text-neon-600 dark:hover:bg-neon-900/30 dark:hover:text-neon-300 transition-colors cursor-pointer"
                  >
                    Jump To
                  </a>
                )}
                {(() => {
                  const ctx = resolveContextSection(json);
                  return ctx ? (
                    <a
                      href="#context-section"
                      onClick={(e) => scrollToSection(e, "context-section")}
                      className="text-[10px] font-bold px-2 py-0.5 rounded bg-(--color-surface-raised) text-(--color-text-secondary) no-underline hover:bg-neon-100 hover:text-neon-600 dark:hover:bg-neon-900/30 dark:hover:text-neon-300 transition-colors cursor-pointer"
                    >
                      {ctx.title}
                    </a>
                  ) : null;
                })()}
              </div>

              {/* TL;DR */}
              <div
                id="tldr"
                className="bg-(--color-surface-raised) rounded-lg p-3 mb-4 scroll-mt-2 transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-neon-600 m-0">
                    TL;DR
                  </h3>
                  <CopyButton
                    text={json.summary}
                    markdownText={`> ${json.summary}`}
                    useMarkdown={copyMarkdown}
                  />
                </div>
                <p className="text-sm text-(--color-text-body) leading-relaxed m-0 italic">
                  {json.summary}
                </p>
              </div>

              {/* Key Points */}
              {json.keyPoints.length > 0 && (
                <div
                  id="highlights"
                  className="bg-(--color-surface-raised) rounded-lg p-3 mb-4 scroll-mt-2 transition-all duration-300"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-neon-600 m-0">
                      Highlights
                    </h3>
                    <CopyButton
                      text={json.keyPoints.map((p) => `• ${p}`).join("\n")}
                      markdownText={json.keyPoints.map((p) => `- ${p}`).join("\n")}
                      useMarkdown={copyMarkdown}
                    />
                  </div>
                  <ul className="list-none p-0 m-0 space-y-1.5">
                    {json.keyPoints.map((point, i) => (
                      <li key={i} className="flex gap-2 text-sm text-(--color-text-body)">
                        <span className="text-neon-500 font-bold shrink-0">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Jump To */}
              {json.timestamps.length > 0 && (
                <div
                  id="jump-to"
                  className="bg-(--color-surface-raised) rounded-lg p-3 mb-4 scroll-mt-2 transition-all duration-300"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-neon-600 m-0">
                      Jump To
                    </h3>
                    <CopyButton
                      text={json.timestamps.join("\n")}
                      markdownText={json.timestamps.map((t) => `- ${t}`).join("\n")}
                      useMarkdown={copyMarkdown}
                    />
                  </div>
                  <ul className="list-none p-0 m-0 space-y-1">
                    {json.timestamps.map((ts, i) => {
                      const parsed = extractTimestamp(ts);
                      if (parsed) {
                        return (
                          <li key={i} className="flex items-baseline gap-2 text-sm">
                            {onSeek ? (
                              <button
                                onClick={() => onSeek(parsed.seconds)}
                                className="w-14 text-right text-neon-600 hover:text-neon-800 bg-transparent border-0 cursor-pointer p-0 font-mono text-xs font-bold shrink-0 transition-colors"
                              >
                                {parsed.time}
                              </button>
                            ) : (
                              <a
                                href={`https://youtube.com/watch?v=${summary.videoId}&t=${parsed.seconds}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-14 text-right text-neon-600 hover:text-neon-800 font-mono text-xs font-bold shrink-0 no-underline transition-colors inline-block"
                              >
                                {parsed.time}
                              </a>
                            )}
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
                </div>
              )}

              {/* Context Section (Action Items or dynamic) */}
              {(() => {
                const ctx = resolveContextSection(json);
                return ctx ? (
                  <div
                    id="context-section"
                    className="bg-(--color-surface-raised) rounded-lg p-3 mb-4 scroll-mt-2 transition-all duration-300"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-neon-600 m-0">
                        {ctx.title}
                      </h3>
                      <CopyButton
                        text={
                          ctx.groups?.length
                            ? ctx.groups
                                .map(
                                  (g) => `${g.label}:\n${g.items.map((i) => `• ${i}`).join("\n")}`,
                                )
                                .join("\n\n")
                            : ctx.items.map((i) => `• ${i}`).join("\n")
                        }
                        markdownText={
                          ctx.groups?.length
                            ? ctx.groups
                                .map(
                                  (g) =>
                                    `### ${g.label}\n${g.items.map((i) => `- ${i}`).join("\n")}`,
                                )
                                .join("\n\n")
                            : ctx.items.map((i) => `- ${i}`).join("\n")
                        }
                        useMarkdown={copyMarkdown}
                      />
                    </div>
                    {ctx.groups?.length ? (
                      <div className="space-y-3">
                        {ctx.groups.map((group, gi) => (
                          <div key={gi}>
                            <h4 className="text-[11px] font-semibold text-(--color-text-secondary) uppercase tracking-wide mb-1 m-0">
                              {group.label}
                            </h4>
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
                  </div>
                ) : null;
              })()}
            </>
          )}

          {activeTab === "chat" && onChat && (
            <div className="flex-1 min-h-0">
              <ChatThread
                summaryId={summary.id}
                hasTranscript={hasTranscript ?? false}
                onChat={onChat}
                onApplyUpdate={async (sj) => {
                  if (onApplyUpdate) {
                    await onApplyUpdate(sj);
                    setSummaryUpdated(true);
                  }
                }}
                onRetry={onRetry}
              />
            </div>
          )}

          {/* Export buttons — rendered externally when pinned=true */}
          {!pinned && (
            <div className="pt-2 border-t border-(--color-border-soft)">
              <ExportBar
                copied={copied}
                copyMarkdown={localCopyMarkdown}
                setCopyMarkdown={setLocalCopyMarkdown}
                onCopy={handleCopy}
                onRetry={summary.status === "completed" ? onRetry : undefined}
                onDismiss={onDismiss}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
