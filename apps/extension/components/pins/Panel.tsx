import { useState } from "react";
import type { Summary } from "@cliphy/shared";
import { MasonryGrid, ClipCard } from "@cliphy/shared";

interface PanelProps {
  title: string;
  clips: Summary[];
  columns?: number;
  onArchive?: (id: string) => void;
}

export function Panel({ title, clips, columns = 4, onArchive }: PanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  function openSource(clip: Summary) {
    const href = clip.sourceUrl ?? clip.videoUrl;
    if (href) window.open(href, "_blank", "noopener");
  }

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-[#6b7280] dark:text-[#9ca3af]">
        {title}
      </h2>
      {clips.length === 0 ? (
        // Render the heading and an empty state rather than vanishing, so
        // "no matches" is distinguishable from "the panel disappeared".
        <p className="text-sm text-[#9ca3af]">Nothing here yet.</p>
      ) : (
        <MasonryGrid
          items={clips}
          columns={columns}
          renderItem={(clip) => (
            <div key={clip.id}>
              {/* Peek inline: clicking a card expands it here rather than
                  navigating. Only the full read leaves the page. */}
              <ClipCard
                item={clip}
                onOpen={(c) => setExpanded((cur) => (cur === c.id ? null : c.id))}
              />
              {expanded === clip.id && (
                <div className="mt-1 rounded-lg border-2 border-black bg-[#f9fafb] p-3 dark:border-[#505050] dark:bg-[#282828]">
                  {clip.summaryJson?.summary ? (
                    <p className="text-[13px] text-[#374151] dark:text-[#d1d5db]">
                      {clip.summaryJson.summary}
                    </p>
                  ) : (
                    <p className="text-[13px] text-[#9ca3af]">No summary yet.</p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => openSource(clip)}
                      className="rounded border-2 border-black px-2 py-1 text-xs font-bold dark:border-[#505050] dark:text-white"
                    >
                      Open
                    </button>
                    {onArchive && (
                      <button
                        type="button"
                        onClick={() => onArchive(clip.id)}
                        className="rounded border-2 border-black px-2 py-1 text-xs font-bold dark:border-[#505050] dark:text-white"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        />
      )}
    </section>
  );
}
