import { Hono } from "hono";

export const billingRoutes = new Hono();

billingRoutes.post("/checkout", async (c) => {
  // TODO: Create Stripe checkout session
  return c.json({ url: "" });
});

billingRoutes.post("/portal", async (c) => {
  // TODO: Create Stripe billing portal session
  return c.json({ url: "" });
});

billingRoutes.post("/webhook", async (c) => {
  // TODO: Handle Stripe webhooks
  return c.json({ received: true });
});
