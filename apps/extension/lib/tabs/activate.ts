/**
 * Switch to a tab from the panel. Same window: activate it. Another window:
 * activate it and focus that window — but some Chromium browsers (Dia) ignore
 * window focus requests, so if the window didn't come forward, bring the tab
 * into the panel's window instead. A click always gets you to the tab.
 */
export async function activateTab(
  tab: { id: number; windowId: number },
  currentWindowId: number | null,
  { settleMs = 150 }: { settleMs?: number } = {},
): Promise<void> {
  await browser.tabs.update(tab.id, { active: true });
  if (currentWindowId == null || tab.windowId === currentWindowId) return;

  let focused: boolean;
  try {
    await browser.windows.update(tab.windowId, { focused: true });
    if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
    focused = !!(await browser.windows.get(tab.windowId))?.focused;
  } catch {
    focused = false;
  }
  if (focused) return;

  await browser.tabs.move(tab.id, { windowId: currentWindowId, index: -1 });
  await browser.tabs.update(tab.id, { active: true });
}
