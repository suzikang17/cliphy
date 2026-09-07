import { useState } from "react";
import type { Summary } from "@cliphy/shared";
import { tagPath } from "@cliphy/shared";
import { updateSummaryTags } from "../../lib/api";

/**
 * Edit a clip's tags. Hierarchy uses the parent:child convention — typing
 * "design:color" nests it; chips render the path as "design › color".
 */
export function TagEditor({ clip }: { clip: Summary }) {
  const [tags, setTags] = useState<string[]>(clip.tags ?? []);
  const [input, setInput] = useState("");

  async function persist(next: string[]) {
    const prev = tags;
    setTags(next);
    try {
      await updateSummaryTags(clip.id, next);
    } catch {
      setTags(prev); // revert on failure (e.g. plan tag limit)
    }
  }

  function add() {
    const normalized = input
      .trim()
      .toLowerCase()
      .replace(/\s*:\s*/g, ":")
      .replace(/^:+|:+$/g, "");
    setInput("");
    if (!normalized || tags.includes(normalized)) return;
    void persist([...tags, normalized]);
  }

  return (
    <div className="mt-2">
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded border border-black bg-[#ede0f8] px-1.5 py-0.5 text-[11px] font-medium text-[#7a3fb0] dark:border-[#505050] dark:bg-[#221028] dark:text-[#b88ae2]"
            >
              {tagPath(t).join(" › ")}
              <button
                type="button"
                onClick={() => void persist(tags.filter((x) => x !== t))}
                className="leading-none text-[#9358c7]"
                aria-label={`Remove ${t}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="Add tag — use design:color to nest"
        className="w-full rounded border-2 border-black bg-white px-2 py-1 text-xs dark:border-[#505050] dark:bg-[#1e1e1e] dark:text-white"
      />
    </div>
  );
}
