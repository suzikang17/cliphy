import { CaptureBar } from "./CaptureBar";
import { TileStrip } from "./TileStrip";
import { Panel } from "./Panel";
import { usePins } from "./usePins";

/**
 * The pins + panels surface. Rendered by both the new tab page (wide, many
 * columns) and the sidepanel's Pins tab (narrow, one column) — `columns` is
 * the only difference between them.
 */
export function PinsBoard({ columns = 4 }: { columns?: number }) {
  const {
    panels,
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

      <CaptureBar onAdded={addPin} />

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

      <Panel title="Inbox" clips={panels.inbox ?? []} columns={columns} onArchive={handleArchive} />
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
