import { useEffect, useState } from "react";
import type { Summary } from "@cliphy/shared";
import { getSummaries } from "../api";

// Your saved Cliphy clips (video + article summaries, saved pages) per tag
// group, so a group is everything about that project — not just open tabs.
// The last list per tag is kept on this browser so groups show it instantly.

export const SAVED_BY_TAG_KEY = "tabs:savedByTag"; // storage.local: tag → Summary[]
export const SAVED_PER_GROUP = 12;

type ByTag = Record<string, Summary[]>;

async function readCache(): Promise<ByTag> {
  try {
    const v = (await browser.storage.local.get(SAVED_BY_TAG_KEY))?.[SAVED_BY_TAG_KEY];
    return v && typeof v === "object" ? (v as ByTag) : {};
  } catch {
    return {};
  }
}

/** tag → its saved clips (newest first), for the given tag groups. */
export function useSavedByTag(tags: string[], authed: boolean | null): ByTag {
  const [byTag, setByTag] = useState<ByTag>({});
  const key = [...new Set(tags)].sort().join("\n");

  useEffect(() => {
    if (!authed || !key) return;
    let live = true;
    const wanted = key.split("\n");
    const fresh = new Set<string>(); // tags the server has answered for
    void readCache().then((cached) => {
      if (!live) return;
      setByTag((prev) => {
        const next = { ...prev };
        for (const t of wanted) if (!fresh.has(t) && cached[t]) next[t] = cached[t];
        return next;
      });
    });
    const answered: ByTag = {};
    void Promise.all(
      wanted.map(async (tag) => {
        try {
          const { summaries } = await getSummaries(tag, SAVED_PER_GROUP);
          if (!live) return;
          fresh.add(tag);
          answered[tag] = summaries;
          setByTag((prev) => ({ ...prev, [tag]: summaries }));
        } catch {
          // offline — the cached list stands
        }
      }),
    ).then(async () => {
      // One write for all tags, so concurrent answers don't overwrite each other.
      if (Object.keys(answered).length === 0) return;
      const cache = await readCache();
      await browser.storage.local
        .set({ [SAVED_BY_TAG_KEY]: { ...cache, ...answered } })
        .catch(() => {});
    });
    return () => {
      live = false;
    };
  }, [key, authed]);

  return byTag;
}
