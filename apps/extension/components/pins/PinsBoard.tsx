import { useState } from "react";
import { CaptureBar } from "./CaptureBar";
import { StowTabsPanel } from "./StowTabsPanel";
import { SuggestedTiles } from "./SuggestedTiles";
import { TileStrip } from "./TileStrip";
import { Panel } from "./Panel";
import { usePins } from "./usePins";
import { addBookmark } from "../../lib/api";

/**
 * The pins + panels surface. Rendered by both the new tab page (wide, many
 * columns) and the sidepanel's Pins tab (narrow, one column) — `columns` is
 * the only difference between them.
 */
export function PinsBoard({ columns = 4 }: { columns?: number }) {
  const {
    panels,
    inboxClips,
    stale,
    undo,
    urlFor,
    addPin,
    handleReorder,
    handleRemove,
    handleArchive,
    handleUndo,
    tilePins,
    viewPanels,
  } = usePins();

  const [showStow, setShowStow] = useState(false);
  const [stowed, setStowed] = useState<{ count: number; urls: string[] } | null>(null);

  return (
    <>
      {stale && (
        <p className="mb-3 text-xs text-(--color-text-faint)">
          Showing cached view — reconnecting…
        </p>
      )}

      {undo && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border-2 border-(--color-border-hard) bg-neon-100 px-3 py-2 text-sm dark:bg-neon-900/40">
          <span>Archived.</span>
          <button type="button" onClick={handleUndo} className="font-bold underline cursor-pointer">
            Undo
          </button>
        </div>
      )}

      {stowed && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border-2 border-(--color-border-hard) bg-neon-100 px-3 py-2 text-sm dark:bg-neon-900/40">
          <span>
            Stowed {stowed.count} tab{stowed.count === 1 ? "" : "s"}.
          </span>
          {/* "Reopen", not "Undo": the tabs come back but the clips stay saved. */}
          <button
            type="button"
            onClick={() => {
              for (const url of stowed.urls) void browser.tabs.create({ url, active: false });
              setStowed(null);
            }}
            className="cursor-pointer font-bold underline"
          >
            Reopen
          </button>
        </div>
      )}

      <CaptureBar onAdded={addPin} />

      <SuggestedTiles
        pinnedUrls={tilePins.map((p) => p.clipUrl ?? "").filter(Boolean)}
        onPin={async (site) => {
          const { pin } = await addBookmark(site.origin, site.host);
          addPin(pin);
        }}
      />

      {showStow ? (
        <StowTabsPanel
          onClose={() => setShowStow(false)}
          onStowed={(count, urls) => setStowed({ count, urls })}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowStow(true)}
          className="mb-4 cursor-pointer rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) px-3 py-1.5 text-xs font-bold text-(--color-text) shadow-brutal-sm hover:shadow-brutal-pressed"
        >
          Stow open tabs
        </button>
      )}

      {tilePins.length > 0 && (
        <section className="mb-6">
          <TileStrip
            pins={tilePins}
            urlFor={urlFor}
            onReorder={handleReorder}
            onRemove={handleRemove}
          />
        </section>
      )}

      <Panel title="Inbox" clips={inboxClips} columns={columns} onArchive={handleArchive} />
      {viewPanels.map((pin) => (
        <Panel
          key={pin.id}
          title={pin.label ?? "View"}
          clips={panels[pin.id] ?? []}
          columns={columns}
          onArchive={handleArchive}
        />
      ))}
    </>
  );
}
