import { Hono } from "hono";

export const privacyRoutes = new Hono();

const LAST_UPDATED = "February 28, 2026";

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy — Cliphy</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; line-height: 1.7; max-width: 720px; margin: 0 auto; padding: 2rem 1.5rem; }
    h1 { font-size: 2rem; margin-bottom: 0.25rem; }
    .updated { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
    h2 { font-size: 1.25rem; margin-top: 2rem; margin-bottom: 0.5rem; }
    p, li { font-size: 1rem; margin-bottom: 0.75rem; }
    ul { padding-left: 1.5rem; }
    a { color: #2563eb; }
    .footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb; color: #666; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated: ${LAST_UPDATED}</p>

  <p>Cliphy ("we", "us", "our") is a Chrome extension that summarizes YouTube videos using AI. This policy explains what data we collect, how we use it, and your rights.</p>

  <h2>Data We Collect</h2>
  <ul>
    <li><strong>Email address</strong> — collected via Google OAuth for authentication.</li>
    <li><strong>YouTube video metadata</strong> — video IDs, titles, and channels for videos you summarize.</li>
    <li><strong>Usage data</strong> — summary counts and queue activity to enforce plan limits.</li>
    <li><strong>Payment information</strong> — handled entirely by Stripe. We never see or store your card details.</li>
  </ul>

  <h2>How We Use Your Data</h2>
  <ul>
    <li>To authenticate you and manage your account.</li>
    <li>To generate AI-powered video summaries.</li>
    <li>To enforce usage limits and process payments.</li>
    <li>To improve the service (aggregate, anonymized usage patterns only).</li>
  </ul>

  <h2>AI Processing</h2>
  <p>Video transcripts are sent to Anthropic's Claude API for summary generation. Anthropic does not use your data for model training. Transcripts are processed in real time and not stored by Anthropic after processing. See <a href="https://www.anthropic.com/privacy">Anthropic's privacy policy</a>.</p>

  <h2>What We Do NOT Do</h2>
  <ul>
    <li>We do <strong>not</strong> sell your data.</li>
    <li>We do <strong>not</strong> track your browsing beyond YouTube.</li>
    <li>We do <strong>not</strong> store raw video transcripts permanently.</li>
    <li>We do <strong>not</strong> share data with third parties, except Stripe (payments) and Anthropic (AI processing).</li>
  </ul>

  <h2>Third-Party Services</h2>
  <ul>
    <li><strong>Stripe</strong> — payment processing (<a href="https://stripe.com/privacy">privacy policy</a>)</li>
    <li><strong>Anthropic</strong> — AI summary generation (<a href="https://www.anthropic.com/privacy">privacy policy</a>)</li>
    <li><strong>Supabase</strong> — database and authentication (<a href="https://supabase.com/privacy">privacy policy</a>)</li>
    <li><strong>Vercel</strong> — hosting (<a href="https://vercel.com/legal/privacy-policy">privacy policy</a>)</li>
  </ul>

  <h2>Data Retention</h2>
  <ul>
    <li><strong>Free users:</strong> Summaries are retained for 7 days.</li>
    <li><strong>Pro users:</strong> Summaries are retained indefinitely.</li>
    <li>You can delete your data at any time by contacting us.</li>
  </ul>

  <h2>Your Rights (GDPR)</h2>
  <p>If you are in the European Economic Area, you have the right to:</p>
  <ul>
    <li><strong>Access</strong> — request a copy of your personal data.</li>
    <li><strong>Rectify</strong> — correct inaccurate data.</li>
    <li><strong>Delete</strong> — request deletion of your data.</li>
    <li><strong>Export</strong> — receive your data in a portable format.</li>
    <li><strong>Object</strong> — object to data processing based on legitimate interest.</li>
  </ul>
  <p>Our legal basis for processing: consent (when you sign up), contractual necessity (to provide the service), and legitimate interest (to improve the service).</p>

  <h2>Data Security</h2>
  <p>We use industry-standard measures including HTTPS encryption, secure token storage, and access controls. Authentication tokens are short-lived and stored in session-scoped browser storage.</p>

  <h2>Children's Privacy</h2>
  <p>Cliphy is not intended for use by children under 13. We do not knowingly collect data from children.</p>

  <h2>Changes to This Policy</h2>
  <p>We may update this policy from time to time. We will notify you of significant changes via the extension or email.</p>

  <h2>Contact</h2>
  <p>For privacy-related questions or data requests, email us at <a href="mailto:privacy@cliphy.app">privacy@cliphy.app</a>.</p>

  <div class="footer">
    <p>&copy; 2026 Cliphy. All rights reserved.</p>
  </div>
</body>
</html>`;

privacyRoutes.get("/", (c) => {
  return c.html(html);
});
