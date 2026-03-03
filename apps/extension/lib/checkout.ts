import { createCheckout } from "./api";

/**
 * Call the checkout API and open the Stripe checkout page in a new tab.
 * Returns true on success, false on failure.
 */
export async function openCheckout(): Promise<boolean> {
  try {
    const { url } = await createCheckout();
    await browser.tabs.create({ url });
    return true;
  } catch (err) {
    console.error("[Cliphy] checkout failed:", err);
    return false;
  }
}
