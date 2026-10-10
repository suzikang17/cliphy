import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TrailItem } from "@cliphy/shared";
import {
  deleteTrailItem,
  getTrailSettings,
  listTrail,
  promoteTrailItem,
  putTrailSettings,
} from "../api";
import { groupTrail, trailRows } from "./group";
import { isTrailEnabled, setTrailEnabled, TRAIL_SAVED_MESSAGE } from "./tracker";

/** Search waits for typing to pause this long before asking the server. */
export const TRAIL_SEARCH_DEBOUNCE_MS = 250;

/**
 * State for the Tabs view's "Recently closed" section. Inactive (no requests)
 * while signed out or until the user opts in.
 */
export function useTrail({ query, authed }: { query: string; authed: boolean | null }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [items, setItems] = useState<TrailItem[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const active = !!authed && enabled === true;
  const q = query.trim();
  const qRef = useRef(q);
  qRef.current = q;
  /** Only the latest list request may write state. */
  const reqId = useRef(0);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    void isTrailEnabled()
      .catch(() => false)
      .then((on) => live && setEnabled(on));
    return () => {
      live = false;
    };
  }, [authed]);

  const load = useCallback(async (search: string, before?: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(false);
    try {
      const res = await listTrail({ q: search || undefined, before });
      if (id !== reqId.current) return;
      setItems((prev) => (before ? [...prev, ...res.items] : res.items));
      setNextBefore(res.nextBefore);
    } catch {
      if (id === reqId.current) setError(true);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  // First page, or search results (debounced while typing).
  useEffect(() => {
    if (!active) return;
    if (!q) {
      void load("");
      return;
    }
    const t = setTimeout(() => void load(q), TRAIL_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [active, q, load]);

  useEffect(() => {
    if (!active) return;
    getTrailSettings()
      .then((s) => setRetentionDays(s.retentionDays))
      .catch(() => {});
  }, [active]);

  // The background tracker just saved closed tabs: refresh the first page.
  useEffect(() => {
    if (!active) return;
    const onMessage = (msg: unknown) => {
      if ((msg as { type?: string })?.type === TRAIL_SAVED_MESSAGE && !qRef.current) {
        void load("");
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [active, load]);

  const groups = useMemo(() => groupTrail(items), [items]);
  const rows = useMemo(() => trailRows(groups), [groups]);

  const drop = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  const toggle = useCallback(async (on: boolean) => {
    setEnabled(on);
    await setTrailEnabled(on);
    if (!on) {
      setItems([]);
      setNextBefore(undefined);
    }
  }, []);

  /** Open it again; it's no longer closed, so it leaves the trail (it returns when you close it). */
  const reopen = useCallback(async (item: TrailItem) => {
    drop(item.id);
    await browser.tabs.create({ url: item.url });
    void deleteTrailItem(item.id).catch(() => {});
  }, []);

  const remove = useCallback(async (item: TrailItem) => {
    drop(item.id);
    try {
      await deleteTrailItem(item.id);
    } catch {
      setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [item, ...prev]));
      setNote("Couldn’t remove — try again");
    }
  }, []);

  const promote = useCallback(async (item: TrailItem) => {
    setNote(null);
    try {
      await promoteTrailItem(item.id);
      drop(item.id);
      setNote(`Saved “${item.title}” to clips`);
    } catch {
      setNote("Couldn’t save — try again");
    }
  }, []);

  const showMore = useCallback(() => {
    if (nextBefore) void load(qRef.current, nextBefore);
  }, [load, nextBefore]);

  const setRetention = useCallback(
    async (days: number | null) => {
      const prev = retentionDays;
      setRetentionDays(days);
      try {
        const s = await putTrailSettings(days);
        setRetentionDays(s.retentionDays);
      } catch {
        setRetentionDays(prev);
        setNote("Couldn’t save the setting — try again");
      }
    },
    [retentionDays],
  );

  return {
    /** Section is shown at all (signed in). */
    visible: !!authed,
    enabled,
    active,
    groups,
    rows,
    hasMore: !!nextBefore,
    loading,
    error,
    note,
    retentionDays,
    searching: !!q,
    toggle,
    reopen,
    remove,
    promote,
    showMore,
    setRetention,
    retry: () => void load(qRef.current),
  };
}

export type TrailState = ReturnType<typeof useTrail>;
