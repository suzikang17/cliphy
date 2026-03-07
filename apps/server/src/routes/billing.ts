import { Hono } from "hono";
import { html } from "hono/html";
import type Stripe from "stripe";
import type { AppEnv } from "../env.js";
import { logger } from "../lib/logger.js";
import { Sentry } from "../lib/sentry.js";
import { supabase } from "../lib/supabase.js";
import { authMiddleware } from "../middleware/auth.js";
import { createCheckoutSession, createPortalSession, stripe } from "../services/stripe.js";

const log = logger.child({ route: "billing" });

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
    log.error("User lookup failed", new Error(error.message), { userId });
    return c.json({ error: "Failed to look up user" }, 500);
  }

  try {
    let customerId = user.stripe_customer_id as string | null;

    // Create Stripe customer if none exists (race-safe: only update if still null)
    if (!customerId) {
      const customer = await stripe.customers.create({ email: userEmail, metadata: { userId } });
      customerId = customer.id;
      const { data: updated } = await supabase
        .from("users")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId)
        .is("stripe_customer_id", null)
        .select("stripe_customer_id")
        .single();

      if (!updated) {
        // Another request already set the customer — use the existing one
        const { data: existing } = await supabase
          .from("users")
          .select("stripe_customer_id")
          .eq("id", userId)
          .single();
        customerId = existing?.stripe_customer_id as string;
        // Clean up the orphan Stripe customer
        await stripe.customers.del(customer.id).catch(() => {});
      }
    }

    const url = await createCheckoutSession(customerId, userId);
    return c.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error("Stripe checkout error", new Error(message), { userId });
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

  try {
    const url = await createPortalSession(user.stripe_customer_id as string);
    return c.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error("Stripe portal error", new Error(message), { userId });
    return c.json({ error: "Failed to create portal session" }, 500);
  }
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
              font-family: "SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: #fff0f6;
            }
            .card {
              text-align: center;
              padding: 3rem 3.5rem;
              background: white;
              border: 2px solid #000;
              border-radius: 12px;
              box-shadow: 4px 4px 0px 0px rgba(0, 0, 0, 1);
              max-width: 400px;
            }
            h1 {
              font-size: 1.5rem;
              font-weight: 700;
              margin: 0 0 0.5rem;
              color: #111827;
            }
            .thank-you {
              color: #a25e84;
              font-size: 1rem;
              margin: 0 0 1rem;
              line-height: 1.5;
            }
            .close-hint {
              color: #6b7280;
              font-size: 0.85rem;
              margin: 0;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Successfully upgraded to Cliphy Pro 🎉</h1>
            <p class="thank-you">
              Cliphy was built with lots of love and support from peeps like you, so thank you &lt;3
            </p>
            <p class="close-hint">You can close this tab and start using Pro features.</p>
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

  const { data: rows, error } = await supabase
    .from("users")
    .update({
      plan: planFromStatus(subscription.status),
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      trial_ends_at: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
    })
    .eq("stripe_customer_id", customerId)
    .select("id");

  if (error) {
    const err = new Error(`Subscription sync failed: ${error.message}`);
    Sentry.captureException(err, { extra: { subscriptionId: subscription.id } });
    throw err;
  }

  if (!rows || rows.length === 0) {
    const err = new Error(`syncSubscription matched 0 rows for customer ${customerId}`);
    Sentry.captureException(err, {
      extra: { customerId, subscriptionId: subscription.id, status: subscription.status },
    });
    throw err;
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
    const { error } = await supabase
      .from("users")
      .update({ stripe_customer_id: customerId })
      .eq("id", userId);
    if (error) {
      const err = new Error(`Checkout customer link failed: ${error.message}`);
      Sentry.captureException(err, { extra: { userId, customerId } });
      throw err;
    }
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
    log.error("Webhook signature verification failed", new Error(message));
    return c.json({ error: "Invalid signature" }, 400);
  }

  log.info("Webhook received", { type: event.type });

  try {
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
        log.warn("Unhandled webhook event", { type: event.type });
    }
  } catch (err) {
    log.error("Webhook handler failed", err instanceof Error ? err : new Error(String(err)), {
      type: event.type,
    });
    Sentry.captureException(err, { extra: { eventType: event.type } });
    await Sentry.flush(2000);
    return c.json({ error: "Webhook handler failed" }, 500);
  }

  return c.json({ received: true });
});
