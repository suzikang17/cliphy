import { useCallback, useEffect, useState } from "react";

export type TabsViewMode = "list" | "tiles";
export const VIEW_KEY = "tabs:view"; // storage.local; list unless you chose tiles

/** List or tiles for the Tabs view, remembered on this browser. */
export function useViewMode() {
  const [view, setView] = useState<TabsViewMode>("list");
  useEffect(() => {
    let live = true;
    void Promise.resolve(browser.storage.local.get(VIEW_KEY))
      .then((r) => {
        if (live && r?.[VIEW_KEY] === "tiles") setView("tiles");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const choose = useCallback((next: TabsViewMode) => {
    setView(next);
    void Promise.resolve(browser.storage.local.set({ [VIEW_KEY]: next })).catch(() => {});
  }, []);
  return { view, choose };
}
