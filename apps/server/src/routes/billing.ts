import { Hono } from "hono";
import type Stripe from "stripe";
import { stripe } from "../services/stripe.js";
import { supabase } from "../lib/supabase.js";

export const billingRoutes = new Hono();

billingRoutes.post("/checkout", async (c) => {
  // TODO: Create Stripe checkout session
  return c.json({ url: "" });
});

billingRoutes.post("/portal", async (c) => {
  // TODO: Create Stripe billing portal session
  return c.json({ url: "" });
});

// ── Webhook helpers ──────────────────────────────────────────

/** Map Stripe subscription status to user plan tier. */
function planFromStatus(status: string): "free" | "pro" {
  return status === "active" || status === "trialing" ? "pro" : "free";
}

/** Update user plan based on a Stripe subscription object. */
async function syncSubscription(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const { error } = await supabase
    .from("users")
    .update({
      plan: planFromStatus(subscription.status),
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      trial_ends_at: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
    })
    .eq("stripe_customer_id", customerId);

  if (error) {
    console.error(`Failed to sync subscription ${subscription.id}: ${error.message}`);
  }
}

/** Handle checkout.session.completed — link customer to user and activate plan. */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription" || !session.subscription || !session.customer) {
    return;
  }

  const customerId = typeof session.customer === "string" ? session.customer : session.customer.id;
  const userId = session.client_reference_id;

  // Link Stripe customer to our user if client_reference_id was set
  if (userId) {
    await supabase.from("users").update({ stripe_customer_id: customerId }).eq("id", userId);
  }

  // Fetch full subscription and sync
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await syncSubscription(subscription);
}

// ── Webhook endpoint ─────────────────────────────────────────

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

  console.log(`Stripe webhook received: ${event.type}`);

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return c.json({ received: true });
});
