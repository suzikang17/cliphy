/** Check if a tab ID matches the current active tab */
export async function isActiveTab(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return true; // No tab info = trust it (e.g. background script)
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id === tabId;
}
