import { useState } from "react";
import { faviconUrl } from "../pins/TileStrip";
import type { GroupKey } from "../../lib/tabs/organize";
import { hostOf, type OpenTab } from "../../lib/tabs/types";
import { setDraggedTab, TAB_DRAG_TYPE } from "../../lib/tabs/dragTab";

interface TabTileProps {
  tab: OpenTab;
  selected: boolean;
  groupKey: GroupKey;
  /** The page's preview image (og:image), when known. */
  image?: string;
  pinned?: boolean;
  dimmed?: boolean;
  onActivate: (tab: OpenTab) => void;
  onClose: (tab: OpenTab) => void;
}

/** One open tab as a tile: preview image (or the site's icon), name, site. */
export function TabTile({
  tab,
  selected,
  groupKey,
  image,
  pinned = false,
  dimmed = false,
  onActivate,
  onClose,
}: TabTileProps) {
  const [imageBroken, setImageBroken] = useState(false);
  // Natural height for photo-ish images (the staggered look); logos and banners
  // (very wide or very tall) sit whole in a fixed box instead of a thin strip.
  const [fit, setFit] = useState<"natural" | "contain">("natural");
  const name = tab.customTitle || tab.title || tab.url;
  const showImage = !!image && !imageBroken;
  return (
    <li
      data-tile
      data-selected={selected || undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TAB_DRAG_TYPE, String(tab.id));
        e.dataTransfer.effectAllowed = "move";
        setDraggedTab({ tab, fromKey: groupKey });
      }}
      onDragEnd={() => setDraggedTab(null)}
      className={`group/tile relative mb-1 min-w-0 break-inside-avoid overflow-hidden rounded border-2 bg-(--color-surface) ${
        selected
          ? "border-(--color-border-hard) ring-2 ring-neon-500"
          : "border-(--color-border-soft)"
      } ${tab.active ? "border-neon-500" : ""} ${dimmed ? "opacity-55" : ""}`}
    >
      <button
        type="button"
        onClick={() => onActivate(tab)}
        title={`${name}\n${tab.url}`}
        className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
      >
        <span
          className={`flex w-full items-center justify-center overflow-hidden bg-neon-100/60 dark:bg-neon-900/30 ${
            !showImage ? "h-9" : fit === "contain" ? "h-14 p-1.5" : ""
          }`}
        >
          {showImage ? (
            <img
              data-preview
              src={image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              data-fit={fit}
              onError={() => setImageBroken(true)}
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                if (w && h) setFit(w / h > 2.4 || w / h < 0.5 ? "contain" : "natural");
              }}
              className={
                fit === "contain"
                  ? "block h-full w-full object-contain"
                  : "block h-auto max-h-36 min-h-12 w-full object-cover"
              }
            />
          ) : (
            <img
              data-favicon
              src={tab.favIconUrl || faviconUrl(tab.url)}
              alt=""
              width={16}
              height={16}
            />
          )}
        </span>
        <span className="block px-1 pt-0.5 pb-0.5">
          <span className="line-clamp-2 text-[9px] font-semibold leading-tight text-(--color-text)">
            {pinned && <span className="mr-0.5">📌</span>}
            {name}
          </span>
          <span className="block truncate text-[8px] text-(--color-text-faint)">
            {hostOf(tab.url)}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onClose(tab)}
        aria-label={`Close ${name}`}
        title="Close tab"
        className="absolute top-0.5 right-0.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-0 bg-black/60 text-[10px] text-white opacity-0 group-hover/tile:opacity-100 focus:opacity-100"
      >
        ✕
      </button>
    </li>
  );
}
