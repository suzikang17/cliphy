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

interface UndoState {
  id: string;
  panelId: string;
  clip: Summary;
}

/**
 * All pins/panels state and behaviour, shared by the new tab page and the
 * sidepanel's Pins view so the two surfaces cannot drift apart.
 */
export function usePins() {
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
        // error page on a surface the user opens dozens of times a day.
        if (!cancelled) setStale(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The API resolves a clip pin's URL via a join. Do NOT derive it from the
  // loaded panels: bookmarks are metadata-tier and therefore excluded from the
  // inbox, so they are never present there and the tile would have no href.
  const urlFor = useCallback((pin: PinnedItem) => pin.clipUrl ?? "", []);

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

  function addPin(pin: PinnedItem) {
    setPins((prev) => [...prev, pin]);
  }

  return {
    pins,
    panels,
    stale,
    undo,
    urlFor,
    addPin,
    handleReorder,
    handleRemove,
    handleArchive,
    handleUndo,
    tilePins: pins.filter((p) => p.layout === "tile"),
    viewPanels: pins.filter((p) => p.layout === "panel" && p.kind === "view"),
  };
}
