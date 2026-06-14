import type { ReactNode } from "react";

export interface DesignSection {
  id: string;
  label: string;
  node: ReactNode;
  sticky?: boolean;
}

// Full-height three-column layout. The side panels fill the space on either
// side of the centered nav and run top-to-bottom; the nav + video + notes sit
// in the centered middle column.
export function DesignPlayground({ sections, nav }: { sections: DesignSection[]; nav: ReactNode }) {
  const byId: Record<string, ReactNode> = {};
  for (const s of sections) byId[s.id] = s.node;
  const get = (id: string) => byId[id] ?? null;

  return (
    <div className="flex h-screen overflow-hidden gap-5">
      {/* Left — timestamps (fills the left margin) */}
      <aside className="flex-1 min-w-0 h-full overflow-y-auto py-5 pl-5 space-y-4">
        {get("jumpTo")}
      </aside>

      {/* Center — the nav, then the video (pinned) + AI content */}
      <div className="w-[48rem] shrink-0 h-full flex flex-col px-6">
        {nav}
        <div className="flex-1 min-h-0 overflow-y-auto pb-5">
          <div className="space-y-4">
            <div className="sticky top-0 z-10 bg-(--color-surface) py-1">{get("player")}</div>
            {get("highlights")}
            {get("context")}
          </div>
        </div>
      </div>

      {/* Right — video details, TL;DR, My Notes (fills the right margin) */}
      <aside className="flex-1 min-w-0 h-full overflow-y-auto py-5 pr-5 space-y-4">
        {get("meta")}
        {get("tldr")}
        {get("notes")}
      </aside>
    </div>
  );
}
