import { useCallback, useEffect, useState } from "react";
import type { PinnedItem, Summary } from "@cliphy/shared";
import {
  getPins,
  getPinItems,
  getSummaries,
  reorderPins,
  deletePin,
  archiveClip,
  unarchiveClip,
} from "../../lib/api";
import { readSnapshot, writeSnapshot } from "../../lib/newtab-cache";
import { TileStrip } from "./TileStrip";
import { CaptureBar } from "./CaptureBar";
import { Panel } from "./Panel";

interface UndoState {
  id: string;
  panelId: string;
  clip: Summary;
}

export function App() {
  const [pins, setPins] = useState<PinnedItem[]>([]);
  const [panels, setPanels] = useState<Record<string, Summary[]>>({});
  const [stale, setStale] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 1. Paint from cache immediately — no network on the critical path.
    void readSnapshot().then((snap) => {
      if (cancelled || !snap) return;
      setPins(snap.pins);
      setPanels(snap.panels);
    });

    // 2. Revalidate behind it.
    void (async () => {
      try {
        const { pins: freshPins } = await getPins();
        const { summaries: inbox } = await getSummaries();
        const viewPanels = freshPins.filter((p) => p.layout === "panel" && p.kind === "view");
        const resolved: Record<string, Summary[]> = { inbox };
        for (const panel of viewPanels) {
          resolved[panel.id] = (await getPinItems(panel.id)).clips;
        }
        if (cancelled) return;
        setPins(freshPins);
        setPanels(resolved);
        setStale(false);
        await writeSnapshot({ pins: freshPins, panels: resolved, savedAt: Date.now() });
      } catch {
        // Offline or API down: the snapshot is still on screen. Never show an
        // error page on a new tab.
        if (!cancelled) setStale(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const clipById = new Map(
    Object.values(panels)
      .flat()
      .map((c) => [c.id, c]),
  );

  const urlFor = useCallback(
    (pin: PinnedItem) => {
      const clip = pin.clipId ? clipById.get(pin.clipId) : undefined;
      return clip?.sourceUrl ?? clip?.videoUrl ?? "";
    },
    [clipById],
  );

  function handleReorder(ids: string[]) {
    setPins(
      (prev) => ids.map((id) => prev.find((p) => p.id === id)).filter(Boolean) as PinnedItem[],
    );
    void reorderPins(ids);
  }

  function handleRemove(id: string) {
    setPins((prev) => prev.filter((p) => p.id !== id));
    void deletePin(id);
  }

  function handleArchive(id: string) {
    let removed: Summary | undefined;
    let fromPanel = "inbox";
    setPanels((prev) => {
      const next: Record<string, Summary[]> = {};
      for (const [panelId, clips] of Object.entries(prev)) {
        const hit = clips.find((c) => c.id === id);
        if (hit && !removed) {
          removed = hit;
          fromPanel = panelId;
        }
        next[panelId] = clips.filter((c) => c.id !== id);
      }
      return next;
    });
    if (removed) setUndo({ id, panelId: fromPanel, clip: removed });
    void archiveClip(id);
  }

  function handleUndo() {
    if (!undo) return;
    setPanels((prev) => ({
      ...prev,
      [undo.panelId]: [undo.clip, ...(prev[undo.panelId] ?? [])],
    }));
    void unarchiveClip(undo.id);
    setUndo(null);
  }

  const viewPanels = pins.filter((p) => p.layout === "panel" && p.kind === "view");

  return (
    <main className="mx-auto max-w-[1400px] p-6">
      {stale && <p className="mb-3 text-xs text-[#9ca3af]">Showing cached view — reconnecting…</p>}

      {undo && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border-2 border-black bg-[#fef9c3] px-3 py-2 text-sm dark:border-[#505050]">
          <span>Archived.</span>
          <button type="button" onClick={handleUndo} className="font-bold underline">
            Undo
          </button>
        </div>
      )}

      <CaptureBar onAdded={(pin) => setPins((prev) => [...prev, pin])} />

      <section className="mb-8">
        <TileStrip
          pins={pins.filter((p) => p.layout === "tile")}
          urlFor={urlFor}
          onReorder={handleReorder}
          onRemove={handleRemove}
        />
      </section>

      <Panel title="Inbox" clips={panels.inbox ?? []} onArchive={handleArchive} />
      {viewPanels.map((pin) => (
        <Panel
          key={pin.id}
          title={pin.label ?? "View"}
          clips={panels[pin.id] ?? []}
          onArchive={handleArchive}
        />
      ))}
    </main>
  );
}
