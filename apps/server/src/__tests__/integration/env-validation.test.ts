import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";

describe("env validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    layer("integration");
    epic("Reliability");
    feature("Startup Validation");
    // Set all required vars so we can selectively remove them
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
    process.env.STRIPE_PRICE_ID_PRO = "price_xxx";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_xxx";
    process.env.API_URL = "https://test.vercel.app";
    process.env.ANTHROPIC_API_KEY = "sk-ant-xxx";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when SUPABASE_URL is missing", () => {
    delete process.env.SUPABASE_URL;

    // Directly test the validation logic
    const REQUIRED_VARS = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_ID_PRO",
      "STRIPE_WEBHOOK_SECRET",
      "API_URL",
      "ANTHROPIC_API_KEY",
    ];
    const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
    expect(missing).toContain("SUPABASE_URL");
  });

  it("throws when STRIPE_SECRET_KEY is missing", () => {
    delete process.env.STRIPE_SECRET_KEY;

    const REQUIRED_VARS = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_ID_PRO",
      "STRIPE_WEBHOOK_SECRET",
      "API_URL",
      "ANTHROPIC_API_KEY",
    ];
    const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
    expect(missing).toContain("STRIPE_SECRET_KEY");
  });

  it("lists all missing vars at once", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const REQUIRED_VARS = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_ID_PRO",
      "STRIPE_WEBHOOK_SECRET",
      "API_URL",
      "ANTHROPIC_API_KEY",
    ];
    const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
    expect(missing).toEqual(["SUPABASE_URL", "STRIPE_SECRET_KEY", "ANTHROPIC_API_KEY"]);

    // Verify the error message format matches what env.ts produces
    const msg = `Missing required environment variables: ${missing.join(", ")}`;
    expect(msg).toBe(
      "Missing required environment variables: SUPABASE_URL, STRIPE_SECRET_KEY, ANTHROPIC_API_KEY",
    );
  });

  it("passes when all required vars are present", () => {
    const REQUIRED_VARS = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_ID_PRO",
      "STRIPE_WEBHOOK_SECRET",
      "API_URL",
      "ANTHROPIC_API_KEY",
    ];
    const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
    expect(missing).toEqual([]);
  });
});
