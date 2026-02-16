import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia",
});

export async function createCheckoutSession(
  customerId: string,
  priceId: string,
): Promise<string> {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.API_URL}/billing/success`,
    cancel_url: `${process.env.API_URL}/billing/cancel`,
  });
  return session.url!;
}

export async function createPortalSession(
  customerId: string,
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.API_URL}/billing`,
  });
  return session.url;
}

export { stripe };
