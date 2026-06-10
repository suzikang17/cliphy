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
  await setMonthlyCount(userId, 0);
}

export async function setMonthlyCount(userId: string, count: number): Promise<void> {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("Count must be a non-negative integer");
  }

  const { error } = await supabase
    .from("users")
    .update({ monthly_summary_count: count })
    .eq("id", userId);

  if (error) throw new Error(`Failed to set count: ${error.message}`);
}

// Add (or claw back, with a negative amount) one-off credits to a user's
// carry-over wallet. The wallet floors at 0. These are spent only after the
// user's monthly allowance is exhausted, and never auto-reset.
export async function grantCredits(userId: string, amount: number): Promise<void> {
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error("Amount must be a non-zero integer");
  }

  const { data: user, error: readErr } = await supabase
    .from("users")
    .select("bonus_credits")
    .eq("id", userId)
    .single();

  if (readErr || !user) throw new Error(`User not found: ${userId}`);

  const next = Math.max(0, ((user.bonus_credits as number) ?? 0) + amount);

  const { error } = await supabase.from("users").update({ bonus_credits: next }).eq("id", userId);

  if (error) throw new Error(`Failed to grant credits: ${error.message}`);
}

// Set the recurring monthly bonus — added to the plan limit every month.
export async function setMonthlyBonus(userId: string, bonus: number): Promise<void> {
  if (!Number.isInteger(bonus) || bonus < 0) {
    throw new Error("Monthly bonus must be a non-negative integer");
  }

  const { error } = await supabase
    .from("users")
    .update({ monthly_limit_bonus: bonus })
    .eq("id", userId);

  if (error) throw new Error(`Failed to set monthly bonus: ${error.message}`);
}
