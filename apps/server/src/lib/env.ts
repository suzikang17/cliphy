/** Required environment variables — validated at import time. */

const REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID_PRO",
  "API_URL",
  "ANTHROPIC_API_KEY",
] as const;

// Warn but don't crash — only needed for the webhook endpoint
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn("⚠ STRIPE_WEBHOOK_SECRET not set — Stripe webhooks will fail");
}

const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}
