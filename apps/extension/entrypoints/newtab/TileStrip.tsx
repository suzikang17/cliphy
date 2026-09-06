import { useState } from "react";
import type { PinnedItem } from "@cliphy/shared";
import { moveTile } from "./tileOrder";

interface TileStripProps {
  pins: PinnedItem[];
  urlFor: (pin: PinnedItem) => string;
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
}

/**
 * Chrome's own favicon cache — no network request, no third-party leak.
 *
 * WXT types getURL() against the extension's declared entrypoints; `_favicon/`
 * is a virtual path Chrome serves at runtime under the "favicon" permission,
 * so it can never appear in that union. Widen the signature rather than
 * hardcoding the chrome-extension:// scheme.
 */
const getExtensionURL = browser.runtime.getURL as (path: string) => string;

export function faviconUrl(pageUrl: string): string {
  const url = new URL(getExtensionURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "32");
  return url.toString();
}

function monogram(label: string): string {
  return (label.trim()[0] ?? "?").toUpperCase();
}

export function TileStrip({ pins, urlFor, onReorder, onRemove }: TileStripProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  if (pins.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {pins.map((pin, index) => {
        const href = urlFor(pin);
        const label = pin.label ?? href ?? "Pin";
        return (
          <a
            key={pin.id}
            href={href || undefined}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex === null) return;
              onReorder(
                moveTile(
                  pins.map((p) => p.id),
                  dragIndex,
                  index,
                ),
              );
              setDragIndex(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onRemove(pin.id);
            }}
            title={label}
            className="flex w-24 flex-col items-center gap-1 rounded-lg border-2 border-black bg-[#f9fafb] p-2 shadow-[3px_3px_0_0_rgba(0,0,0,1)] dark:border-[#505050] dark:bg-[#282828] dark:shadow-[3px_3px_0_0_rgba(255,255,255,0.12)]"
          >
            {broken[pin.id] || !href ? (
              <span className="flex h-8 w-8 items-center justify-center rounded bg-black text-sm font-bold text-white dark:bg-[#505050]">
                {monogram(label)}
              </span>
            ) : (
              <img
                src={faviconUrl(href)}
                alt=""
                width={32}
                height={32}
                onError={() => setBroken((b) => ({ ...b, [pin.id]: true }))}
              />
            )}
            <span className="w-full truncate text-center text-[11px] font-bold text-[#111827] dark:text-white">
              {label}
            </span>
          </a>
        );
      })}
    </div>
  );
}
