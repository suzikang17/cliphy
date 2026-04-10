import type { ChatMessage, ChatResponse, SummaryJson } from "@cliphy/shared";
import { useEffect, useRef, useState } from "react";

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
      className="text-(--color-text-faint) hover:text-neon-600 bg-transparent hover:bg-neon-100 dark:hover:bg-neon-900/30 border-0 p-1 rounded cursor-pointer transition-all"
      title="Copy"
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

const LIST_RE = /^[-*•]\s|^\d+[.)]\s/;

/** Lightweight markdown-ish formatter for chat responses */
function FormattedText({ text }: { text: string }) {
  // Split into segments: paragraphs and list runs (even within same block)
  const segments: { type: "p" | "ul" | "ol" | "hr"; lines: string[] }[] = [];

  let lastBlank = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      // Blank line — force a new segment on the next non-blank line
      lastBlank = true;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      segments.push({ type: "hr", lines: [] });
      lastBlank = false;
      continue;
    }

    const isListItem = LIST_RE.test(trimmed);
    const isOrdered = /^\d+[.)]\s/.test(trimmed);

    if (isListItem) {
      const listType = isOrdered ? "ol" : "ul";
      const prev = segments[segments.length - 1];
      if (prev && prev.type === listType && !lastBlank) {
        prev.lines.push(trimmed);
      } else {
        segments.push({ type: listType, lines: [trimmed] });
      }
    } else {
      // Each non-list line gets its own paragraph
      segments.push({ type: "p", lines: [trimmed] });
    }
    lastBlank = false;
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "hr") {
          return <hr key={i} className="my-2 border-(--color-border-soft)" />;
        }
        if (seg.type === "ul" || seg.type === "ol") {
          const Tag = seg.type === "ol" ? "ol" : "ul";
          return (
            <Tag
              key={i}
              className={`${seg.type === "ol" ? "list-decimal" : "list-disc"} pl-4 my-1`}
            >
              {seg.lines.map((l, li) => (
                <li key={li}>
                  <InlineFormat text={l.replace(/^[-*•]\s*|^\d+[.)]\s*/, "")} />
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i} className={i > 0 ? "mt-2" : ""}>
            <InlineFormat text={seg.lines.join(" ")} />
          </p>
        );
      })}
    </>
  );
}

/** Handles **bold**, *italic*, and `code` */
function InlineFormat({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  // Match **bold**, *italic*, or `code`
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={match.index}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={match.index}>{match[3]}</em>);
    } else if (match[4]) {
      parts.push(
        <code
          key={match.index}
          className="bg-(--color-surface-raised) px-1 py-0.5 rounded text-[11px]"
        >
          {match[4]}
        </code>,
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

interface ChatThreadProps {
  summaryId: string;
  hasTranscript: boolean;
  active?: boolean;
  onChat: (messages: ChatMessage[]) => Promise<ChatResponse>;
  onApplyUpdate: (summaryJson: SummaryJson) => Promise<void>;
  onRetry?: () => void;
  onLoadHistory?: () => Promise<ChatMessage[]>;
}

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  update?: {
    section: string;
    summaryJson: SummaryJson;
    applied: boolean;
    dismissed: boolean;
  };
}

export function ChatThread({
  summaryId,
  hasTranscript,
  active,
  onChat,
  onApplyUpdate,
  onRetry,
  onLoadHistory,
}: ChatThreadProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setInput("");
    setError(null);
    setLoading(false);

    if (onLoadHistory) {
      onLoadHistory()
        .then((history) => {
          setMessages(
            history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          );
        })
        .catch(() => {
          setMessages([]);
        });
    } else {
      setMessages([]);
    }
  }, [summaryId]);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, active]);

  if (!hasTranscript) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4">
        <p className="text-sm text-(--color-text-faint) text-center">
          Chat is not available for this summary. Re-summarize to enable.
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs font-bold px-3 py-1.5 bg-(--color-surface-raised) text-(--color-text-secondary) border border-(--color-border-soft) rounded-lg hover:text-neon-600 hover:border-neon-500 cursor-pointer transition-all"
          >
            Re-summarize
          </button>
        )}
      </div>
    );
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);

    const userMsg: DisplayMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const history: ChatMessage[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: text },
      ];

      const response = await onChat(history);

      const assistantMsg: DisplayMessage = {
        role: "assistant",
        content: response.content,
        update:
          response.type === "update" && response.updatedSummaryJson
            ? {
                section: response.updatedSection ?? "summary",
                summaryJson: response.updatedSummaryJson,
                applied: false,
                dismissed: false,
              }
            : undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApplyUpdate(index: number) {
    const msg = messages[index];
    if (!msg.update || msg.update.applied) return;

    try {
      await onApplyUpdate(msg.update.summaryJson);
      setMessages((prev) =>
        prev.map((m, i) =>
          i === index && m.update ? { ...m, update: { ...m.update, applied: true } } : m,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply update.");
    }
  }

  function handleDismissUpdate(index: number) {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === index && m.update ? { ...m, update: { ...m.update, dismissed: true } } : m,
      ),
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const sectionLabel: Record<string, string> = {
    summary: "TL;DR",
    keyPoints: "Highlights",
    timestamps: "Jump To",
    contextSection: "Context",
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 && !loading && (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-(--color-text-faint)">Ask me anything about this video...</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 group/msg ${
                msg.role === "user"
                  ? "bg-(--color-surface-raised) text-(--color-text)"
                  : "bg-neon-100/30 dark:bg-neon-900/20 text-(--color-text)"
              }`}
            >
              <div className="text-xs leading-relaxed">
                {msg.role === "assistant" ? (
                  <FormattedText text={msg.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>

              {msg.role === "assistant" && (
                <div className="flex justify-end mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                  <CopyButton text={msg.content} />
                </div>
              )}

              {msg.update && !msg.update.dismissed && (
                <div className="mt-2 pt-2 border-t border-(--color-border-soft)">
                  {msg.update.applied ? (
                    <p className="text-[10px] font-bold text-neon-600 dark:text-neon-400">
                      ✓ Applied to {sectionLabel[msg.update.section] ?? msg.update.section}
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApplyUpdate(i)}
                        className="text-[10px] font-bold px-2 py-1 bg-neon-600 text-white rounded-md cursor-pointer hover:bg-neon-700 transition-colors"
                      >
                        Apply to summary
                      </button>
                      <button
                        onClick={() => handleDismissUpdate(i)}
                        className="text-[10px] font-bold px-2 py-1 bg-(--color-surface-raised) text-(--color-text-faint) rounded-md cursor-pointer hover:bg-(--color-surface) transition-colors"
                      >
                        Keep original
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-neon-100/30 dark:bg-neon-900/20 rounded-lg px-3 py-2">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-neon-600 animate-pulse" />
                <div className="w-1.5 h-1.5 rounded-full bg-neon-600 animate-pulse [animation-delay:0.2s]" />
                <div className="w-1.5 h-1.5 rounded-full bg-neon-600 animate-pulse [animation-delay:0.4s]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="px-3 py-1">
          <p className="text-[10px] text-red-500">{error}</p>
        </div>
      )}

      <div className="shrink-0 px-3 py-2 border-t border-(--color-border-soft)">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question..."
            rows={1}
            className="flex-1 text-xs bg-(--color-surface-raised) text-(--color-text) border-2 border-(--color-border-hard) rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-neon-500 placeholder:text-(--color-text-faint)"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="text-xs font-bold px-3 py-2 bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
