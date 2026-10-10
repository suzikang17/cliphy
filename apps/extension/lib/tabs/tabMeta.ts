import { normalizeUrl } from "./dedupe";

// Your own name and a quick note for a page, set from the Tabs view. Keyed by
// the page (normalized URL), not the tab: tab ids change on restart, and the
// same page reopened should keep its name/note. Local only (storage.local);
// it travels with the page when you close it (trail), stow it or ⌘⇧S it.

export const META_PREFIX = "tabs:meta:";
export const MAX_TITLE = 200;
export const MAX_NOTE = 500;

export interface TabMeta {
  title?: string;
  note?: string;
}

const keyFor = (url: string) => `${META_PREFIX}${normalizeUrl(url) ?? url}`;

function clean(meta: TabMeta): TabMeta {
  const out: TabMeta = {};
  const title = meta.title?.trim().replace(/\s+/g, " ").slice(0, MAX_TITLE);
  const note = meta.note?.trim().slice(0, MAX_NOTE);
  if (title) out.title = title;
  if (note) out.note = note;
  return out;
}

export async function getTabMeta(url: string): Promise<TabMeta> {
  try {
    const key = keyFor(url);
    const r = await browser.storage.local.get(key);
    return (r?.[key] as TabMeta | undefined) ?? {};
  } catch {
    return {};
  }
}

/** Merge a change into a page's name/note; removes the entry when both are empty. */
export async function setTabMeta(url: string, patch: TabMeta): Promise<TabMeta> {
  const key = keyFor(url);
  const next = clean({ ...(await getTabMeta(url)), ...patch });
  if (!next.title && !next.note) await browser.storage.local.remove(key);
  else await browser.storage.local.set({ [key]: next });
  return next;
}

/** Every page's name/note, keyed by normalized URL. */
export async function loadAllTabMeta(): Promise<Record<string, TabMeta>> {
  try {
    const all = ((await browser.storage.local.get(null)) ?? {}) as Record<string, unknown>;
    const out: Record<string, TabMeta> = {};
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(META_PREFIX) && v && typeof v === "object") {
        out[k.slice(META_PREFIX.length)] = v as TabMeta;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Look up a page in a loadAllTabMeta() map. */
export function metaFor(map: Record<string, TabMeta>, url: string): TabMeta {
  return map[normalizeUrl(url) ?? url] ?? {};
}
