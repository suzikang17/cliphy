import { useEffect, useState } from "react";
import { isWebUrl, type OpenTab } from "./types";

// Preview images for the tile view: each page's og:image address, read from the
// page itself only while the tile view is on, and remembered on this browser
// (address only, never sent anywhere). "No image" is remembered too.

export const PREVIEWS_KEY = "tabs:previews"; // storage.local: url → { img, at }
const MAX_PREVIEWS = 500;
/** A sleeping / still-loading tab may never answer — don't wait on it. */
export const PREVIEW_TIMEOUT_MS = 1500;
const BATCH = 4;

type Stored = Record<string, { img: string | null; at: number }>;

/**
 * Injected with `scripting.executeScript` — must stay self-contained (no
 * imports, no module scope).
 */
export function readPreviewImage(): string | null {
  const meta =
    document.querySelector('meta[property="og:image"]') ??
    document.querySelector('meta[name="og:image"]') ??
    document.querySelector('meta[name="twitter:image"]') ??
    document.querySelector('meta[property="twitter:image"]');
  const raw = (meta?.getAttribute("content") ?? "").trim();
  if (!raw) return null;
  try {
    const abs = new URL(raw, location.href);
    return abs.protocol === "https:" || abs.protocol === "http:" ? abs.href : null;
  } catch {
    return null;
  }
}

async function load(): Promise<Stored> {
  try {
    const v = (await browser.storage.local.get(PREVIEWS_KEY))?.[PREVIEWS_KEY];
    return v && typeof v === "object" ? (v as Stored) : {};
  } catch {
    return {};
  }
}

async function save(map: Stored): Promise<void> {
  const kept = Object.entries(map)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_PREVIEWS);
  await browser.storage.local.set({ [PREVIEWS_KEY]: Object.fromEntries(kept) }).catch(() => {});
}

async function readFrom(tab: OpenTab): Promise<string | null | undefined> {
  try {
    const injected = browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPreviewImage,
    });
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), PREVIEW_TIMEOUT_MS));
    const out = await Promise.race([injected, timeout]);
    if (!out) return undefined; // timed out — try again another time
    return (out[0]?.result as string | null | undefined) ?? null;
  } catch {
    return undefined; // no access to this page (permission, chrome:// …)
  }
}

/** url → preview image for the given tabs (only those that have one). */
export function useTabPreviews(tabs: OpenTab[], active: boolean): Record<string, string> {
  const [images, setImages] = useState<Record<string, string>>({});
  const urls = tabs.map((t) => t.url).join("\n");

  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      const stored = await load();
      const show = () => {
        if (!live) return;
        const next: Record<string, string> = {};
        for (const t of tabs) {
          const img = stored[t.url]?.img;
          if (img) next[t.url] = img;
        }
        setImages(next);
      };
      show();
      const missing = tabs.filter((t) => !(t.url in stored) && isWebUrl(t.url) && !t.discarded);
      for (let i = 0; i < missing.length && live; i += BATCH) {
        const batch = missing.slice(i, i + BATCH);
        const found = await Promise.all(batch.map(readFrom));
        let changed = false;
        batch.forEach((t, j) => {
          if (found[j] === undefined) return;
          stored[t.url] = { img: found[j] ?? null, at: Date.now() };
          changed = true;
        });
        if (changed) {
          await save(stored);
          show();
        }
      }
    })();
    return () => {
      live = false;
    };
    // `urls` stands in for `tabs`: re-run only when the set of pages changes.
  }, [urls, active]);

  return images;
}
