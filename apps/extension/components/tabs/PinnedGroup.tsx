import { faviconUrl } from "../pins/TileStrip";
import { hostOf, type OpenTab } from "../../lib/tabs/types";
import type { PagePin } from "../../lib/tabs/pins";
import { Kbd } from "./Kbd";

interface PinnedGroupProps {
  pins: PagePin[];
  /** Open tabs by normalized page key — open pins live in their tag group (📌). */
  openByKey: Map<string, OpenTab>;
  selectedPinId: string | null;
  showLabels?: boolean;
  onOpen: (pin: PagePin) => void;
  onUnpin: (pin: PagePin) => void;
}

/**
 * Your parking lot: pinned pages that aren't open right now. Click/Enter opens
 * one; ✕ unpins (the clip stays in your library). Always first in the panel.
 */
export function PinnedGroup({
  pins,
  openByKey,
  selectedPinId,
  showLabels = false,
  onOpen,
  onUnpin,
}: PinnedGroupProps) {
  if (pins.length === 0) return null;
  const open = pins.filter((p) => openByKey.has(p.key)).length;
  const closed = pins.filter((p) => !openByKey.has(p.key));

  return (
    <section
      aria-label="Pinned"
      className="mb-3 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) shadow-brutal-sm"
    >
      <header className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="text-xs font-extrabold text-(--color-text)">📌 Pinned</span>
        <span className="text-[10px] font-bold text-(--color-text-faint)">
          {pins.length}
          {open > 0 && ` · ${open} open`}
        </span>
        {showLabels && (
          <span className="ml-auto text-[9px] text-(--color-text-faint)">
            <Kbd className="ml-0">p</Kbd> pin / unpin
          </span>
        )}
      </header>
      {closed.length > 0 && (
        <ul className="m-0 list-none border-t border-(--color-border-soft) p-1">
          {closed.map((pin) => (
            <li
              key={pin.pinId}
              data-selected={pin.pinId === selectedPinId || undefined}
              className={`group/row flex items-center gap-2 rounded-md px-1.5 py-1 ${
                pin.pinId === selectedPinId ? "ring-2 ring-(--color-border-hard)" : ""
              }`}
            >
              <img src={faviconUrl(pin.url)} alt="" width={16} height={16} className="shrink-0" />
              <button
                type="button"
                onClick={() => onOpen(pin)}
                title={pin.url}
                className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
              >
                <span className="block truncate text-xs font-semibold text-(--color-text)">
                  {pin.title}
                </span>
                <span className="block truncate text-[10px] text-(--color-text-faint)">
                  {hostOf(pin.url)} · pinned
                </span>
              </button>
              <button
                type="button"
                onClick={() => onUnpin(pin)}
                aria-label={`Unpin ${pin.title}`}
                title="Unpin (the clip stays in your library)"
                className="cursor-pointer border-0 bg-transparent px-1 text-xs text-(--color-text-faint) opacity-0 hover:text-(--color-text) group-hover/row:opacity-100 focus:opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
