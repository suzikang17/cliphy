/**
 * The tab to land on when the active tab is closed along with others: the next
 * remaining tab to its right in the same window, else the nearest on its left.
 * null when the active tab isn't being closed (nothing to do) or none remain.
 */
export function pickNextTab(
  windowTabs: { id: number; index: number }[],
  activeId: number,
  closing: Set<number>,
): number | null {
  if (!closing.has(activeId)) return null;
  const strip = [...windowTabs].sort((a, b) => a.index - b.index);
  const at = strip.findIndex((t) => t.id === activeId);
  if (at === -1) return null;
  const right = strip.slice(at + 1).find((t) => !closing.has(t.id));
  if (right) return right.id;
  const left = strip
    .slice(0, at)
    .reverse()
    .find((t) => !closing.has(t.id));
  return left?.id ?? null;
}

/**
 * Close tabs; if one is the tab you're on, land on the next remaining tab first
 * (explicitly, so it's predictable rather than whatever Chrome picks).
 */
export async function closeTabsAndAdvance(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const closing = new Set(ids);
  const [active] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id != null && closing.has(active.id) && active.windowId != null) {
    const windowTabs = await browser.tabs.query({ windowId: active.windowId });
    const next = pickNextTab(
      windowTabs
        .filter((t: { id?: number }) => t.id != null)
        .map((t: { id?: number; index: number }) => ({ id: t.id as number, index: t.index })),
      active.id,
      closing,
    );
    if (next != null) await browser.tabs.update(next, { active: true });
  }
  await browser.tabs.remove(ids);
}
