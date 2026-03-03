import { Hono } from "hono";
import { html } from "hono/html";
import type Stripe from "stripe";
import type { AppEnv } from "../env.js";
import { supabase } from "../lib/supabase.js";
import { authMiddleware } from "../middleware/auth.js";
import { createCheckoutSession, createPortalSession, stripe } from "../services/stripe.js";

export const billingRoutes = new Hono<AppEnv>();

// ── Authenticated routes ────────────────────────────────────

billingRoutes.post("/checkout", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const userEmail = c.get("userEmail");

  // Look up existing Stripe customer
  const { data: user, error } = await supabase
    .from("users")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();

  if (error) {
    console.error(`Checkout: user lookup failed for ${userId}:`, error.message);
    return c.json({ error: "Failed to look up user" }, 500);
  }

  try {
    let customerId = user.stripe_customer_id as string | null;

    // Create Stripe customer if none exists
    if (!customerId) {
      const customer = await stripe.customers.create({ email: userEmail, metadata: { userId } });
      customerId = customer.id;
      await supabase.from("users").update({ stripe_customer_id: customerId }).eq("id", userId);
    }

    const url = await createCheckoutSession(customerId, userId);
    return c.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Checkout: Stripe error for ${userId}:`, message);
    return c.json({ error: "Failed to create checkout session" }, 500);
  }
});

billingRoutes.post("/portal", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const { data: user, error } = await supabase
    .from("users")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();

  if (error) {
    return c.json({ error: "Failed to look up user" }, 500);
  }

  if (!user.stripe_customer_id) {
    return c.json({ error: "No subscription to manage" }, 400);
  }

  const url = await createPortalSession(user.stripe_customer_id as string);
  return c.json({ url });
});

// ── Success / Cancel pages ──────────────────────────────────

billingRoutes.get("/success", (c) => {
  return c.html(
    html`<!doctype html>
      <html>
        <head>
          <title>Cliphy Pro</title>
          <style>
            body {
              font-family: system-ui, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: #f8f9fa;
            }
            .card {
              text-align: center;
              padding: 3rem;
              background: white;
              border-radius: 12px;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>You're on Pro!</h1>
            <p>You can close this tab.</p>
          </div>
        </body>
      </html>`,
  );
});

billingRoutes.get("/cancel", (c) => {
  return c.html(
    html`<!doctype html>
      <html>
        <head>
          <title>Cliphy</title>
          <style>
            body {
              font-family: system-ui, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: #f8f9fa;
            }
            .card {
              text-align: center;
              padding: 3rem;
              background: white;
              border-radius: 12px;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Checkout cancelled</h1>
            <p>You can close this tab.</p>
          </div>
        </body>
      </html>`,
  );
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
