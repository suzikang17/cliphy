import { createCheckout } from "./api";

/**
 * Call the checkout API and open the Stripe checkout page in a new tab.
 * Calls `onSuccess` if the tab navigates to the billing success page.
 */
export async function openCheckout(onSuccess?: () => void): Promise<boolean> {
  try {
    const { url } = await createCheckout();
    const tab = await browser.tabs.create({ url });

    if (onSuccess && tab.id) {
      const tabId = tab.id;
      const listener = (_id: number, info: { url?: string }) => {
        if (_id === tabId && info.url?.includes("/billing/success")) {
          browser.tabs.onUpdated.removeListener(listener);
          onSuccess();
        }
      };
      // Clean up if the tab is closed before completing
      const closeListener = (closedId: number) => {
        if (closedId === tabId) {
          browser.tabs.onUpdated.removeListener(listener);
          browser.tabs.onRemoved.removeListener(closeListener);
        }
      };
      browser.tabs.onUpdated.addListener(listener);
      browser.tabs.onRemoved.addListener(closeListener);
    }

    return true;
  } catch (err) {
    console.error("[Cliphy] checkout failed:", err);
    return false;
  }
}
