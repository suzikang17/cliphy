import type { ChatMessage, ChatResponse, SummaryJson } from "@cliphy/shared";
import { useEffect, useRef, useState } from "react";

interface ChatThreadProps {
  summaryId: string;
  hasTranscript: boolean;
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  if (!hasTranscript) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4">
        <p className="text-sm text-(--color-text-faint) text-center">
          Chat is not available for this summary. Re-summarize to enable.
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs font-bold px-3 py-1.5 bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all"
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
            <p className="text-xs text-(--color-text-faint)">Ask anything about this video...</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 ${
                msg.role === "user"
                  ? "bg-(--color-surface-raised) text-(--color-text)"
                  : "bg-neon-100/30 dark:bg-neon-900/20 text-(--color-text)"
              }`}
            >
              <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>

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
