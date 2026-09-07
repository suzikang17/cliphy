import { useEffect, useRef, useState } from "react";
import type { Summary } from "@cliphy/shared";
import { getTodayNote, updateNote, localDate } from "../../lib/api";

/**
 * Today's note, editable in place. Saves on blur and after a pause rather than
 * on every keystroke — a note is written in bursts, and each save re-embeds.
 */
export function DailyNote({ refreshKey = 0 }: { refreshKey?: number }) {
  const [note, setNote] = useState<Summary | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const date = localDate();

  useEffect(() => {
    void (async () => {
      try {
        const { note: today } = await getTodayNote(date);
        setNote(today);
        setDraft(today?.content ?? "");
      } catch {
        // Offline — leave the editor empty rather than blocking the panel.
      }
    })();
  }, [date, refreshKey]);

  async function save(content: string) {
    if (!note || content === (note.content ?? "")) return;
    setSaving(true);
    try {
      const { note: updated } = await updateNote(note.id, content);
      setNote(updated);
    } catch {
      // Keep the draft on screen; the next save or blur retries.
    } finally {
      setSaving(false);
    }
  }

  function onChange(value: string) {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(value), 1200);
  }

  const lineCount = draft.split("\n").filter(Boolean).length;

  return (
    <section className="mb-4 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) p-3 shadow-brutal-sm">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="cursor-pointer border-0 bg-transparent p-0 text-[10px] font-bold uppercase text-(--color-text-faint) hover:text-(--color-text)"
        >
          {open ? "▾" : "▸"} Today · {date}
          {lineCount > 0 ? ` · ${lineCount}` : ""}
        </button>
        {saving && <span className="text-[10px] text-(--color-text-faint)">Saving…</span>}
      </div>

      {open &&
        (note ? (
          <textarea
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => void save(draft)}
            rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
            aria-label="Today's note"
            className="w-full resize-y rounded border-2 border-(--color-border-soft) bg-transparent p-2 text-[13px] text-(--color-text) outline-none focus:border-(--color-border-hard)"
          />
        ) : (
          <p className="text-xs text-(--color-text-faint)">
            Type anything that isn&apos;t a link above to start today&apos;s note.
          </p>
        ))}
    </section>
  );
}
