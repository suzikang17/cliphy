import { useEffect, useRef } from "react";
import { OPEN_TABS_VIEW_FLAG } from "./cache";

/** Background → side panel: switch to the Tabs view and focus search. */
export interface OpenTabsViewMessage {
  type: "OPEN_TABS_VIEW";
}

/** A flag older than this is stale (e.g. the panel failed to open). */
const FLAG_TTL_MS = 10_000;

/**
 * Calls `onOpen` when the keyboard command asks for the Tabs view. Two paths,
 * because a freshly opened panel mounts after the background's message is sent:
 * a runtime message for an already-open panel, and a storage.session flag read
 * on mount.
 */
export function useOpenTabsViewSignal(onOpen: () => void) {
  const cb = useRef(onOpen);
  cb.current = onOpen;

  useEffect(() => {
    const consume = () => {
      void browser.storage.session.remove(OPEN_TABS_VIEW_FLAG).catch(() => {});
      cb.current();
    };

    void browser.storage.session
      .get(OPEN_TABS_VIEW_FLAG)
      .then((r: Record<string, unknown>) => {
        const at = r[OPEN_TABS_VIEW_FLAG];
        if (typeof at === "number" && Date.now() - at < FLAG_TTL_MS) consume();
      })
      .catch(() => {});

    const onMessage = (message: unknown) => {
      if ((message as OpenTabsViewMessage | undefined)?.type === "OPEN_TABS_VIEW") consume();
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);
}
