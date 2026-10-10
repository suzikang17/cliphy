import { useState } from "react";
import type { Summary } from "@cliphy/shared";
import { SuggestedTags, tagPath } from "@cliphy/shared";
import { dismissSuggestedTag, TagLimitError, updateSummaryTags } from "../../lib/api";
import { UpgradePrompt } from "../UpgradePrompt";

/**
 * Edit a clip's tags. Hierarchy uses the parent:child convention — typing
 * "design:color" nests it; chips render the path as "design › color".
 */
export function TagEditor({ clip }: { clip: Summary }) {
  const [tags, setTags] = useState<string[]>(clip.tags ?? []);
  // AI-suggested tags live here too so accepting one updates `tags` in the same state.
  const [suggested, setSuggested] = useState<string[]>(clip.suggestedTags ?? []);
  const [input, setInput] = useState("");
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  async function persist(next: string[], nextSuggested = suggested) {
    const prev = tags;
    const prevSuggested = suggested;
    setTags(next);
    setSuggested(nextSuggested);
    try {
      const res = await updateSummaryTags(clip.id, next);
      if (res.suggestedTags) setSuggested(res.suggestedTags);
    } catch (err) {
      // revert on failure; on the free-plan tag limit, also say why and offer the upgrade
      setTags(prev);
      setSuggested(prevSuggested);
      if (err instanceof TagLimitError) setLimitMessage(err.message);
    }
  }

  function acceptSuggestion(tag: string) {
    void persist(
      tags.includes(tag) ? tags : [...tags, tag],
      suggested.filter((t) => t !== tag),
    );
  }

  async function dismissSuggestion(tag: string) {
    const prev = suggested;
    setSuggested(prev.filter((t) => t !== tag));
    try {
      const res = await dismissSuggestedTag(clip.id, tag);
      setSuggested(res.suggestedTags);
    } catch {
      setSuggested(prev);
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
      {limitMessage && (
        <div className="mb-2">
          <UpgradePrompt
            message={limitMessage}
            onDismiss={() => setLimitMessage(null)}
            onUpgraded={() => setLimitMessage(null)}
          />
        </div>
      )}
      <SuggestedTags
        tags={suggested}
        onAccept={acceptSuggestion}
        onDismiss={(tag) => void dismissSuggestion(tag)}
        className="mb-2"
      />
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
