import type { GroupKey } from "./organize";
import type { OpenTab } from "./types";

/** dataTransfer type for a dragged tab row (distinct from a dragged group). */
export const TAB_DRAG_TYPE = "application/x-cliphy-tab";

/**
 * The tab being dragged. dataTransfer can't be read during dragover, so the
 * row and its group live here for the drop targets to check.
 */
let dragged: { tab: OpenTab; fromKey: GroupKey } | null = null;

export const setDraggedTab = (d: typeof dragged) => {
  dragged = d;
};
export const getDraggedTab = () => dragged;
