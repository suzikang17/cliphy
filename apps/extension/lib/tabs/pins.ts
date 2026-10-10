import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeUrl, type PinnedItem } from "@cliphy/shared";
import { deletePin, getPins, pinPage } from "../api";
import { readSnapshot, writeSnapshot } from "../newtab-cache";

// Page pins in the Tabs view. A pin is a bookmark-tier clip + a new-tab tile
// (server: POST /api/pins/page); here we keep them keyed by normalized page so
// open tabs, Trail rows and ⌘⇧P all agree on "is this pinned".

export interface PagePin {
  pinId: string;
  clipId: string;
  url: string;
  /** normalizeUrl(url) */
  key: string;
  title: string;
  /** The pinned clip's tags. */
  tags?: string[];
}

export function pagePinsFrom(pins: PinnedItem[]): PagePin[] {
  const out: PagePin[] = [];
  for (const p of pins) {
    if (p.kind !== "clip" || !p.clipId || !p.clipUrl) continue;
    out.push({
      pinId: p.id,
      clipId: p.clipId,
      url: p.clipUrl,
      key: normalizeUrl(p.clipUrl) ?? p.clipUrl,
      title: p.label || p.clipTitle || p.clipUrl,
      tags: p.clipTags ?? [],
    });
  }
  return out;
}

export interface PinUndo {
  text: string;
  run: () => Promise<void>;
}

export function usePagePins(authed: boolean | null) {
  const [pins, setPins] = useState<PagePin[]>([]);
  const [undo, setUndo] = useState<PinUndo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rawPins = useRef<PinnedItem[]>([]);
  const mounted = useRef(true);

  const adopt = useCallback((raw: PinnedItem[]) => {
    rawPins.current = raw;
    setPins(pagePinsFrom(raw));
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!authed) return;
    // Paint from the new-tab snapshot first, then revalidate.
    void readSnapshot().then((snap) => {
      if (mounted.current && snap && rawPins.current.length === 0) adopt(snap.pins);
    });
    void getPins()
      .then((r) => mounted.current && adopt(r.pins))
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, [authed, adopt]);

  /** Keep the new-tab board in step without a round trip. */
  const syncSnapshot = useCallback(async (raw: PinnedItem[]) => {
    const snap = (await readSnapshot()) ?? { pins: [], panels: {}, savedAt: 0 };
    await writeSnapshot({ ...snap, pins: raw, savedAt: Date.now() });
  }, []);

  const byKey = useMemo(() => new Map(pins.map((p) => [p.key, p])), [pins]);
  // Callbacks captured earlier (e.g. an Undo) must see the current pins, not a stale closure.
  const byKeyRef = useRef(byKey);
  byKeyRef.current = byKey;
  const isPinned = useCallback((url: string) => byKey.has(normalizeUrl(url) ?? url), [byKey]);

  const pin = useCallback(
    async (tab: { url: string; title: string; note?: string }) => {
      const key = normalizeUrl(tab.url) ?? tab.url;
      if (byKeyRef.current.has(key)) return;
      setError(null);
      const optimistic: PagePin = {
        pinId: `pending:${key}`,
        clipId: "",
        url: tab.url,
        key,
        title: tab.title,
      };
      setPins((p) => [...p, optimistic]);
      try {
        const res = await pinPage({
          url: tab.url,
          title: tab.title,
          ...(tab.note && { note: tab.note }),
        });
        if (!mounted.current) return;
        const raw = [...rawPins.current.filter((p) => p.id !== res.pin.id), res.pin];
        adopt(raw);
        void syncSnapshot(raw);
      } catch {
        if (!mounted.current) return;
        setPins((p) => p.filter((x) => x.key !== key));
        setError("Couldn’t pin — try again");
      }
    },
    [adopt, syncSnapshot],
  );

  const unpin = useCallback(
    async (url: string) => {
      const key = normalizeUrl(url) ?? url;
      const target = byKeyRef.current.get(key);
      if (!target) return;
      const raw = rawPins.current.filter((p) => p.id !== target.pinId);
      adopt(raw);
      try {
        await deletePin(target.pinId);
        void syncSnapshot(raw);
        setUndo({
          text: `Unpinned ${target.title}`,
          run: async () => {
            setUndo(null);
            await pin({ url: target.url, title: target.title });
          },
        });
      } catch {
        if (!mounted.current) return;
        adopt(
          [...raw, rawPins.current.find((p) => p.id === target.pinId)].filter(
            Boolean,
          ) as PinnedItem[],
        );
        setError("Couldn’t unpin — try again");
      }
    },
    [adopt, syncSnapshot, pin],
  );

  return { pins, byKey, isPinned, pin, unpin, undo, error, dismissUndo: () => setUndo(null) };
}

export type PagePinsState = ReturnType<typeof usePagePins>;
