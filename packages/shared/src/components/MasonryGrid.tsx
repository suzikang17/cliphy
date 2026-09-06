import type { ReactNode } from "react";
import type { Summary } from "../types";
import { splitColumns } from "../masonry";

interface MasonryGridProps {
  items: Summary[];
  columns?: number;
  renderItem: (clip: Summary) => ReactNode;
}

export function MasonryGrid({ items, columns = 4, renderItem }: MasonryGridProps) {
  const cols = splitColumns(items, columns);
  return (
    <div className="flex gap-3">
      {cols.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">
          {col.map((clip) => renderItem(clip))}
        </div>
      ))}
    </div>
  );
}
