import type { ContextSection, Summary } from "@cliphy/shared";
import { formatTimeSaved, parseDurationToSeconds, TAG_MAX_LENGTH } from "@cliphy/shared";
import { useRef, useState } from "react";

interface SummaryDetailProps {
  summary: Summary;
  allTags?: string[];
  tagLimitReached?: boolean;
  onTagsChange?: (tags: string[]) => void;
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
    for (const item of ctxMd.items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
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
    for (const item of ctxPt.items) {
      lines.push(`• ${item}`);
    }
    lines.push("");
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
    <div className="flex flex-wrap items-center gap-1.5 mb-4">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border border-(--color-border-soft)"
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
        <div className="inline-flex items-center">
          <input
            ref={inputRef}
            type="text"
            list="tag-suggestions"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleAdd}
            maxLength={TAG_MAX_LENGTH}
            placeholder="tag name"
            className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-neon-300 bg-(--color-surface) text-(--color-text) outline-none w-24"
            autoFocus
          />
          <datalist id="tag-suggestions">
            {suggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      ) : tagLimitReached ? (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">
          Upgrade for more tags
        </span>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-(--color-surface-raised) text-(--color-text-secondary) border border-(--color-border-soft) hover:border-neon-300 hover:text-neon-600 cursor-pointer transition-colors"
          title="Add tag"
        >
          + tag
        </button>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in extension contexts
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="text-(--color-text-faint) hover:text-(--color-text) bg-transparent border-0 p-0 cursor-pointer transition-colors"
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

type CopyState = "idle" | "markdown" | "text";

export function SummaryDetail({
  summary,
  allTags,
  tagLimitReached,
  onTagsChange,
  onSeek,
  onDismiss,
}: SummaryDetailProps) {
  const [copied, setCopied] = useState<CopyState>("idle");
  const json = summary.summaryJson;

  function scrollToSection(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-neon-400", "ring-offset-2");
    setTimeout(() => el.classList.remove("ring-2", "ring-neon-400", "ring-offset-2"), 800);
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
      <div className="flex items-start gap-3 mb-4">
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
          </div>
        </div>
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

      {!json ? (
        <p className="text-(--color-text-muted) text-sm">No summary data available.</p>
      ) : (
        <>
          {/* Truncation warning */}
          {json.truncated && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded-lg px-3 py-2 mb-4 text-xs text-amber-700 dark:text-amber-400">
              This summary is based on a partial transcript. The video was too long to process in
              full.
            </div>
          )}

          {/* Inline TOC */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <a
              href="#tldr"
              onClick={(e) => scrollToSection(e, "tldr")}
              className="text-[10px] font-bold px-2 py-0.5 rounded bg-(--color-surface-raised) text-(--color-text-secondary) no-underline hover:bg-(--color-border-soft) transition-colors"
            >
              TL;DR
            </a>
            {json.keyPoints.length > 0 && (
              <a
                href="#highlights"
                onClick={(e) => scrollToSection(e, "highlights")}
                className="text-[10px] font-bold px-2 py-0.5 rounded bg-(--color-surface-raised) text-(--color-text-secondary) no-underline hover:bg-(--color-border-soft) transition-colors"
              >
                Highlights
              </a>
            )}
            {json.timestamps.length > 0 && (
              <a
                href="#jump-to"
                onClick={(e) => scrollToSection(e, "jump-to")}
                className="text-[10px] font-bold px-2 py-0.5 rounded bg-(--color-surface-raised) text-(--color-text-secondary) no-underline hover:bg-(--color-border-soft) transition-colors"
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
                  className="text-[10px] font-bold px-2 py-0.5 rounded bg-(--color-surface-raised) text-(--color-text-secondary) no-underline hover:bg-(--color-border-soft) transition-colors"
                >
                  {ctx.title}
                </a>
              ) : null;
            })()}
          </div>

          {/* TL;DR */}
          <div
            id="tldr"
            className="bg-(--color-surface-raised) rounded-lg p-3 mb-4 transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-neon-600 m-0">TL;DR</h3>
              <CopyButton text={json.summary} />
            </div>
            <p className="text-sm text-(--color-text-body) leading-relaxed m-0 italic">
              {json.summary}
            </p>
          </div>

          {/* Key Points */}
          {json.keyPoints.length > 0 && (
            <div
              id="highlights"
              className="bg-(--color-surface-raised) rounded-lg p-3 mb-4 transition-all duration-300"
            >
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-xs font-bold uppercase tracking-wide text-neon-600 m-0">
                  Highlights
                </h3>
                <CopyButton text={json.keyPoints.map((p) => `• ${p}`).join("\n")} />
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
              className="bg-(--color-surface-raised) rounded-lg p-3 mb-4 transition-all duration-300"
            >
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-xs font-bold uppercase tracking-wide text-neon-600 m-0">
                  Jump To
                </h3>
                <CopyButton text={json.timestamps.join("\n")} />
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
                className="bg-(--color-surface-raised) rounded-lg p-3 mb-4 transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-neon-600 m-0">
                    {ctx.title}
                  </h3>
                  <CopyButton text={ctx.items.map((i) => `• ${i}`).join("\n")} />
                </div>
                <ul className="list-none p-0 m-0 space-y-1.5">
                  {ctx.items.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm text-(--color-text-body)">
                      <span className="text-neon-500 font-bold shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null;
          })()}

          {/* Export buttons */}
          <div className="flex gap-2 pt-2 border-t border-(--color-border-soft)">
            <button
              onClick={() => handleCopy("markdown")}
              className="text-xs font-bold px-3 py-1.5 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all"
            >
              {copied === "markdown" ? "Copied!" : "Copy Markdown"}
            </button>
            <button
              onClick={() => handleCopy("text")}
              className="text-xs font-bold px-3 py-1.5 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all"
            >
              {copied === "text" ? "Copied!" : "Copy Text"}
            </button>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="ml-auto text-xs px-2 py-1.5 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all text-(--color-text-faint) hover:text-red-500"
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
