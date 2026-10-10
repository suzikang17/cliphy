import { groupLabel, type GroupKey } from "../../lib/tabs/organize";
import { useEffect, useState } from "react";
import { fromDays, toDays, type RetentionUnit } from "../../lib/trail/retention";
import type { TrailItem } from "@cliphy/shared";
import { Kbd } from "./Kbd";
import { faviconUrl } from "../pins/TileStrip";
import { formatAgo } from "../../lib/tabs/openedAt";
import type { TrailState } from "../../lib/trail/useTrail";

const linkBtn =
  "cursor-pointer border-0 bg-transparent p-0 text-[11px] font-bold text-(--color-text-faint) hover:text-(--color-text) disabled:opacity-50";

interface TrailSectionProps {
  trail: TrailState;
  selectedId: string | null;
  now: number;
  showLabels?: boolean;
  /** Groups a closed tab can be reopened into. */
  groupTargets?: GroupKey[];
  onReopenInto?: (item: TrailItem, key: GroupKey) => void;
}

/** "Recently closed": tabs you closed, saved to your trail (opt-in). */
export function TrailSection({
  trail,
  selectedId,
  now,
  showLabels = false,
  groupTargets = [],
  onReopenInto,
}: TrailSectionProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  if (!trail.visible || trail.enabled === null) return null;

  const toggle = (
    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-bold text-(--color-text-faint)">
      <input
        type="checkbox"
        role="switch"
        checked={trail.enabled}
        onChange={(e) => void trail.toggle(e.target.checked)}
        className="cursor-pointer accent-neon-600"
      />
      Remember tabs I close
    </label>
  );

  return (
    <section
      aria-label="Recently closed"
      className="mb-3 rounded-lg border-2 border-(--color-border-hard) bg-(--color-surface) shadow-brutal-sm"
    >
      <header className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-extrabold text-(--color-text)">
          Recently closed
        </span>
        {toggle}
        {trail.enabled && (
          <span className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Recently closed settings"
              aria-expanded={menuOpen}
              className={linkBtn}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-5 z-10 rounded-md border-2 border-(--color-border-hard) bg-(--color-surface) px-3 py-2 shadow-brutal-sm">
                <RetentionPicker
                  days={trail.retentionDays}
                  onChange={(d) => void trail.setRetention(d)}
                />
              </div>
            )}
          </span>
        )}
      </header>

      {trail.showNotice ? (
        <div className="mx-2.5 mb-2 rounded-md bg-neon-100/60 px-2.5 py-2 dark:bg-neon-900/25">
          <p className="m-0 text-[11px] leading-snug text-(--color-text)">
            Cliphy now remembers tabs you close — address and title only, never page content — so
            nothing is lost. Searches, sign-in pages and quick peeks are skipped.
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void trail.dismissNotice(true)}
              className="flex h-6 cursor-pointer items-center rounded-md border-0 bg-neon-600 px-2.5 text-[11px] font-bold text-white hover:bg-neon-700"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => void trail.dismissNotice(false)}
              className="flex h-6 cursor-pointer items-center rounded-md border-0 bg-transparent px-1.5 text-[11px] font-semibold text-(--color-text-faint) hover:text-(--color-text)"
            >
              Turn off
            </button>
          </div>
        </div>
      ) : (
        <p className="m-0 px-2.5 pb-1.5 text-[11px] leading-snug text-(--color-text-faint)">
          {trail.enabled
            ? "The address and title of each page you close are sent to Cliphy and saved to your trail."
            : "When on, the address and title of each page you close are sent to Cliphy and saved to your trail, so you can search and reopen it later. Page content is never read. Searches, sign-in pages and tabs open under 10 seconds are skipped."}
        </p>
      )}

      {trail.note && (
        <p className="m-0 px-2.5 pb-1 text-[11px] text-(--color-text-faint)">{trail.note}</p>
      )}

      {trail.active && (
        <div className="border-t border-(--color-border-soft) p-1">
          {trail.error ? (
            <p className="m-0 flex items-center gap-2 px-1.5 py-1 text-xs text-red-600">
              Couldn’t load your trail.
              <button
                type="button"
                onClick={trail.retry}
                className="cursor-pointer border-0 bg-transparent p-0 text-xs font-bold text-red-600 underline"
              >
                Retry
              </button>
            </p>
          ) : trail.rows.length === 0 ? (
            <p className="m-0 px-1.5 py-1 text-xs text-(--color-text-faint)">
              {trail.loading
                ? "Loading…"
                : trail.searching
                  ? "No closed tabs match."
                  : "Nothing yet. Tabs you close will show up here."}
            </p>
          ) : (
            trail.groups.map((g) => (
              <div key={g.key || "other"} className="mb-1 last:mb-0">
                <p className="m-0 px-1.5 pt-1 text-[10px] font-bold uppercase text-(--color-text-faint)">
                  {g.label} <span className="font-normal">{g.items.length}</span>
                </p>
                <ul className="m-0 list-none p-0">
                  {g.items.map((item) => (
                    <TrailRow
                      key={item.id}
                      item={item}
                      selected={item.id === selectedId}
                      now={now}
                      showLabels={showLabels}
                      onReopen={() => void trail.reopen(item)}
                      canPlace={!!onReopenInto}
                      groupTargets={groupTargets}
                      onReopenInto={(key) => onReopenInto?.(item, key)}
                      onPromote={() => void trail.promote(item)}
                      onRemove={() => void trail.remove(item)}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
          {trail.hasMore && (
            <button
              type="button"
              disabled={trail.loading}
              onClick={trail.showMore}
              className={`${linkBtn} px-1.5 py-1`}
            >
              {trail.loading ? "Loading…" : "Show more"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function TrailRow({
  item,
  selected,
  now,
  showLabels,
  onReopen,
  canPlace,
  groupTargets,
  onReopenInto,
  onPromote,
  onRemove,
}: {
  canPlace: boolean;
  item: TrailItem;
  selected: boolean;
  now: number;
  showLabels: boolean;
  onReopen: () => void;
  groupTargets: GroupKey[];
  onReopenInto: (key: GroupKey) => void;
  onPromote: () => void;
  onRemove: () => void;
}) {
  const [iconBroken, setIconBroken] = useState(false);
  const closedAt = Date.parse(item.closedAt);
  // The group its tag (from Jev/keywords at close time) already points to — one click, no new AI call.
  const suggested: GroupKey | null = canPlace && item.tags[0] ? `tag:${item.tags[0]}` : null;
  const others = canPlace ? groupTargets.filter((k) => k !== suggested) : [];
  return (
    <li
      data-selected={selected || undefined}
      className={`group/row flex items-center gap-2 rounded-md px-1.5 py-1 ${
        selected ? "ring-2 ring-(--color-border-hard)" : ""
      }`}
    >
      {iconBroken ? (
        <span className="w-4 shrink-0" />
      ) : (
        <img
          src={faviconUrl(item.url)}
          alt=""
          width={16}
          height={16}
          className="shrink-0"
          onError={() => setIconBroken(true)}
        />
      )}
      <button
        type="button"
        onClick={onReopen}
        title={`${item.customTitle ? `Page title: ${item.title}\n` : ""}${item.url}\nClosed ${new Date(closedAt).toLocaleString()}`}
        className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left"
      >
        <span className="block truncate text-xs font-semibold text-(--color-text)">
          {item.customTitle || item.title || item.url}
        </span>
        {item.note && (
          <span className="block truncate text-[10px] italic text-(--color-text)">
            📝 {item.note}
          </span>
        )}
        <span className="block truncate text-[10px] text-(--color-text-faint)">
          {[
            item.host,
            Number.isNaN(closedAt) ? "" : `closed ${formatAgo(closedAt, now)}`,
            item.closeCount > 1 ? `${item.closeCount}×` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {showLabels && selected && (
          <span className="mt-0.5 block text-[9px] text-(--color-text-faint)">
            <Kbd className="ml-0">↵</Kbd> reopen <Kbd>s</Kbd> save to clips <Kbd>x</Kbd> remove
          </span>
        )}
      </button>
      <span className="flex shrink-0 items-center gap-1 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
        {suggested && (
          <button
            type="button"
            onClick={() => onReopenInto(suggested)}
            title={`Reopen into ${groupLabel(suggested)}`}
            aria-label={`Reopen ${item.title} into ${groupLabel(suggested)}`}
            className="h-6 max-w-32 shrink-0 cursor-pointer truncate rounded border border-(--color-border-soft) bg-neon-100/70 px-1.5 py-0 text-[11px] leading-none font-bold text-(--color-text) hover:bg-neon-100 dark:bg-neon-900/30"
          >
            ↳ {groupLabel(suggested)}
          </button>
        )}
        {others.length > 0 && (
          <select
            aria-label={`Reopen ${item.title} into`}
            title="Reopen into a group…"
            value=""
            onChange={(e) => {
              if (e.target.value) onReopenInto(e.target.value as GroupKey);
            }}
            className="w-16 shrink-0 cursor-pointer rounded border border-(--color-border-soft) bg-(--color-surface) py-0.5 pr-0.5 pl-1.5 text-[11px] text-(--color-text-faint)"
          >
            <option value="">Into</option>
            {others.map((k) => (
              <option key={k} value={k}>
                {groupLabel(k)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={onPromote}
          title="Save to clips"
          aria-label={`Save ${item.title} to clips`}
          className="cursor-pointer border-0 bg-transparent px-1 text-xs text-(--color-text-faint) hover:text-(--color-text)"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Remove from trail"
          aria-label={`Remove ${item.title} from trail`}
          className="cursor-pointer border-0 bg-transparent px-1 text-xs text-(--color-text-faint) hover:text-red-600"
        >
          ✕
        </button>
      </span>
    </li>
  );
}

const UNITS: { value: RetentionUnit; label: string }[] = [
  { value: "days", label: "days" },
  { value: "weeks", label: "weeks" },
  { value: "months", label: "months" },
  { value: "forever", label: "forever" },
];

/** "Keep closed tabs for [3] [weeks ▾]" — any amount; forever hides the amount. */
function RetentionPicker({
  days,
  onChange,
}: {
  days: number | null;
  onChange: (days: number | null) => void;
}) {
  const [draft, setDraft] = useState(() => fromDays(days));
  useEffect(() => setDraft(fromDays(days)), [days]);
  const commit = (next: { amount: number; unit: RetentionUnit }) => {
    setDraft(next);
    onChange(toDays(next));
  };
  return (
    <label className="block whitespace-nowrap text-[10px] font-bold uppercase text-(--color-text-faint)">
      Keep closed tabs for
      <span className="mt-1 flex items-center gap-1 normal-case">
        {draft.unit !== "forever" && (
          <input
            type="number"
            min={1}
            value={draft.amount}
            aria-label="Keep closed tabs amount"
            onChange={(e) => commit({ ...draft, amount: Number(e.target.value) || 1 })}
            className="w-14 rounded border border-(--color-border-hard) bg-(--color-surface) px-1 text-xs text-(--color-text)"
          />
        )}
        <select
          value={draft.unit}
          aria-label="Keep closed tabs unit"
          onChange={(e) => commit({ ...draft, unit: e.target.value as RetentionUnit })}
          className="rounded border border-(--color-border-hard) bg-(--color-surface) text-xs text-(--color-text)"
        >
          {UNITS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
