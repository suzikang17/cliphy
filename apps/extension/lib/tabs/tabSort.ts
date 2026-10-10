import { normalizeUrl } from "@cliphy/shared";
import { hostOf, type OpenTab } from "./types";

/** How a group orders its tabs. "manual" = your order (the default). */
export type TabSort = "manual" | "recent" | "name" | "site";

export const TAB_SORTS: { value: TabSort; label: string }[] = [
  { value: "manual", label: "Your order" },
  { value: "recent", label: "Recent" },
  { value: "name", label: "A–Z" },
  { value: "site", label: "Site" },
];

const page = (t: OpenTab) => normalizeUrl(t.url) ?? t.url;
const name = (t: OpenTab) => (t.customTitle || t.title || t.url).toLowerCase();

/**
 * Sort a group's tabs. In your order, pages you've placed keep their places
 * (`order` holds page keys); pages you haven't placed stay on top in the
 * order they came in (new tabs show up first).
 */
export function sortTabs(tabs: OpenTab[], sort: TabSort, order: string[]): OpenTab[] {
  const list = [...tabs];
  switch (sort) {
    case "recent":
      return list.sort((x, y) => y.lastAccessed - x.lastAccessed);
    case "name":
      return list.sort((x, y) => name(x).localeCompare(name(y)));
    case "site":
      return list.sort(
        (x, y) => hostOf(x.url).localeCompare(hostOf(y.url)) || name(x).localeCompare(name(y)),
      );
    default: {
      const at = new Map(order.map((k, i) => [k, i]));
      const placed = list.filter((t) => at.has(page(t)));
      const fresh = list.filter((t) => !at.has(page(t)));
      return [...fresh, ...placed.sort((x, y) => at.get(page(x))! - at.get(page(y))!)];
    }
  }
}

/** Your order after moving `tab` before `before` (null = to the end), as page keys. */
export function moveInOrder(current: OpenTab[], tab: OpenTab, before: OpenTab | null): string[] {
  const keys = current.map(page).filter((k) => k !== page(tab));
  const i = before ? keys.indexOf(page(before)) : -1;
  keys.splice(i < 0 ? keys.length : i, 0, page(tab));
  return [...new Set(keys)];
}
