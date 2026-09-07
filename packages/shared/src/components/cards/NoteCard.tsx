import type { NoteClipMetadata } from "../../types";
import { CARD_SHELL, CARD_TITLE, CARD_META } from "./cardShell";
import type { CardProps } from "./WebCard";

export function NoteCard({ item, onOpen }: CardProps) {
  const meta = (item.sourceMetadata ?? {}) as unknown as NoteClipMetadata;
  const lines = (item.content ?? "").split("\n").filter(Boolean);

  return (
    <button type="button" onClick={() => onOpen?.(item)} className={CARD_SHELL}>
      <p className={`${CARD_META} mb-1`}>✎ {meta.noteDate ?? "Note"}</p>
      {lines.length === 0 ? (
        <p className={`${CARD_TITLE} text-[#9ca3af]`}>Empty note</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {lines.slice(0, 6).map((line, i) => (
            <li key={i} className="line-clamp-2 text-[13px] text-[#111827] dark:text-white">
              · {line}
            </li>
          ))}
        </ul>
      )}
      {lines.length > 6 && <p className={`${CARD_META} mt-1`}>+{lines.length - 6} more</p>}
    </button>
  );
}
