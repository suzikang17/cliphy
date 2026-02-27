import { Hono } from "hono";
import type Stripe from "stripe";
import { stripe } from "../services/stripe.js";

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
  const signature = c.req.header("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return c.json({ error: "Missing signature or webhook secret" }, 400);
  }

  const rawBody = await c.req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Webhook signature verification failed: ${message}`);
    return c.json({ error: "Invalid signature" }, 400);
  }

  // TODO: Handle specific event types (checkout.session.completed, etc.)
  console.log(`Stripe webhook received: ${event.type}`);

  return c.json({ received: true });
});
