import { useCallback, useEffect, useRef, useState } from "react";
import type { TabSort } from "./tabSort";

// Per group: how its tabs are sorted, and your own order (page keys) for
// "Your order". Kept on this browser.

export const TAB_SORT_KEY = "tabs:groupSort"; // storage.local

interface Stored {
  sorts: Record<string, TabSort>;
  orders: Record<string, string[]>;
}

export function useTabSort() {
  const [stored, setStored] = useState<Stored>({ sorts: {}, orders: {} });
  const ref = useRef(stored);
  ref.current = stored;

  useEffect(() => {
    let live = true;
    void Promise.resolve(browser.storage.local.get(TAB_SORT_KEY))
      .then((r) => {
        const v = r?.[TAB_SORT_KEY] as Partial<Stored> | undefined;
        if (live && v) setStored({ sorts: v.sorts ?? {}, orders: v.orders ?? {} });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const write = useCallback((next: Stored) => {
    ref.current = next;
    setStored(next);
    void Promise.resolve(browser.storage.local.set({ [TAB_SORT_KEY]: next })).catch(() => {});
  }, []);

  const setSort = useCallback(
    (key: string, sort: TabSort) =>
      write({ ...ref.current, sorts: { ...ref.current.sorts, [key]: sort } }),
    [write],
  );
  const setOrder = useCallback(
    (key: string, order: string[]) =>
      write({ ...ref.current, orders: { ...ref.current.orders, [key]: order } }),
    [write],
  );
  // Stable per stored value, so they can be memo dependencies.
  const sortFor = useCallback(
    (key: string): TabSort => stored.sorts[key] ?? "manual",
    [stored.sorts],
  );
  const orderFor = useCallback(
    (key: string): string[] => stored.orders[key] ?? [],
    [stored.orders],
  );

  return { sortFor, orderFor, setSort, setOrder };
}
