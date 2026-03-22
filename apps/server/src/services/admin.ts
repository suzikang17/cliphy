import { supabase } from "../lib/supabase.js";
import Stripe from "stripe";

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function downgradeUser(userId: string): Promise<void> {
  // Fetch current subscription
  const { data: user, error } = await supabase
    .from("users")
    .select("stripe_subscription_id")
    .eq("id", userId)
    .single();

  if (error || !user) throw new Error(`User not found: ${userId}`);

  // Cancel Stripe subscription if exists
  if (user.stripe_subscription_id) {
    const stripe = getStripe();
    try {
      await stripe.subscriptions.cancel(user.stripe_subscription_id);
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== "resource_missing") throw err;
    }
  }

  // Reset DB
  const { error: updateErr } = await supabase
    .from("users")
    .update({
      plan: "free",
      stripe_customer_id: null,
      stripe_subscription_id: null,
      subscription_status: "none",
    })
    .eq("id", userId);

  if (updateErr) throw new Error(`Failed to downgrade: ${updateErr.message}`);
}

export async function upgradeUser(userId: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({
      plan: "pro",
      subscription_status: "active",
    })
    .eq("id", userId);

  if (error) throw new Error(`Failed to upgrade: ${error.message}`);
}

export async function cancelSubscription(userId: string): Promise<void> {
  const { data: user, error } = await supabase
    .from("users")
    .select("stripe_subscription_id")
    .eq("id", userId)
    .single();

  if (error || !user) throw new Error(`User not found: ${userId}`);
  if (!user.stripe_subscription_id) throw new Error("No subscription to cancel");

  const stripe = getStripe();
  await stripe.subscriptions.cancel(user.stripe_subscription_id);

  await supabase.from("users").update({ subscription_status: "canceled" }).eq("id", userId);
}

export async function resetMonthlyCount(userId: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ monthly_summary_count: 0 })
    .eq("id", userId);

  if (error) throw new Error(`Failed to reset count: ${error.message}`);
}
