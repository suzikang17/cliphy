import type { ClosedGroup } from "@cliphy/shared";
import { formatAgo } from "../../lib/tabs/openedAt";
import { Kbd } from "./Kbd";

interface ClosedGroupsProps {
  groups: ClosedGroup[];
  now: number;
  selectedKey: string | null;
  showLabels?: boolean;
  onResume: (key: string) => void;
  /** Remove it for good. */
  onForget?: (key: string) => void;
}

/** Groups you closed as a whole. Resume reopens what was open + the group's pins. */
export function ClosedGroups({
  groups,
  now,
  selectedKey,
  showLabels = false,
  onResume,
  onForget,
}: ClosedGroupsProps) {
  if (groups.length === 0) return null;
  return (
    <section
      aria-label="Closed groups"
      className="mb-3 rounded-lg border-2 border-dashed border-(--color-border-hard) bg-(--color-surface)"
    >
      <header className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="text-xs font-extrabold text-(--color-text)">Closed groups</span>
        <span className="text-[10px] font-bold text-(--color-text-faint)">{groups.length}</span>
      </header>
      <ul className="m-0 list-none border-t border-(--color-border-soft) p-1">
        {groups.map((g) => {
          const closedAt = Date.parse(g.closedAt);
          return (
            <li
              key={g.key}
              data-selected={g.key === selectedKey || undefined}
              className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${
                g.key === selectedKey ? "ring-2 ring-(--color-border-hard)" : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-(--color-text)">
                  {g.label}
                </span>
                <span className="block truncate text-[10px] text-(--color-text-faint)">
                  {g.pages.length} {g.pages.length === 1 ? "tab" : "tabs"} · closed{" "}
                  {Number.isNaN(closedAt) ? "earlier" : formatAgo(closedAt, now)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onResume(g.key)}
                aria-label={`Resume ${g.label}`}
                className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border-0 bg-neon-600 px-2 text-[11px] font-bold text-white hover:bg-neon-700"
              >
                Resume
                {showLabels && (
                  <Kbd className="ml-0.5 border-white/40 bg-transparent text-white">↵</Kbd>
                )}
              </button>
              {onForget && (
                <button
                  type="button"
                  onClick={() => onForget(g.key)}
                  title="Forget this group (its pages stay in Recently closed)"
                  aria-label={`Forget ${g.label}`}
                  className="shrink-0 cursor-pointer border-0 bg-transparent px-1 text-xs text-(--color-text-faint) hover:text-red-600"
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
