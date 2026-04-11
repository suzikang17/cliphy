import { Link, Navigate } from "react-router";
import { useAuth } from "../lib/auth-context";
import { Nav } from "../components/Nav";

export function Landing() {
  const { user, loading } = useAuth();

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="max-w-4xl mx-auto px-6">
      <Nav />

      {/* Hero */}
      <section className="text-center py-12 pb-16">
        <h1 className="text-5xl font-bold tracking-tight mb-2 flex items-center justify-center gap-3">
          <img src="/logo.svg" alt="" width="48" height="48" className="rounded-xl" />
          Cliphy
        </h1>
        <p className="text-xl font-medium text-neon-700 dark:text-neon-400 mb-4">
          AI-powered YouTube video summaries
        </p>
        <p className="text-lg text-(--color-text-secondary) max-w-xl mx-auto mb-8 leading-relaxed">
          Queue up YouTube videos and get concise, structured AI summaries &mdash; no ads, no
          waiting. Come back to your summaries whenever you're ready.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <a
            href="#"
            className="inline-flex items-center gap-2 bg-[#fff0f6] text-(--color-text) font-semibold text-base px-7 py-3 border-2 border-(--color-border-hard) rounded-xl shadow-brutal hover:shadow-brutal-hover press-down no-underline transition-all"
          >
            <ChromeIcon />
            Install Chrome Extension
          </a>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 bg-neon-600 text-white font-semibold text-base px-7 py-3 border-2 border-(--color-border-hard) rounded-xl shadow-brutal hover:shadow-brutal-hover press-down no-underline transition-all"
          >
            Sign in to Dashboard
          </Link>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-12">
        <h2 className="text-2xl font-bold tracking-tight text-center mb-8">How It Works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {[
            {
              n: 1,
              title: "Queue your videos",
              desc: "Browse YouTube normally. Add videos to your queue with one click — queue as many as you want and come back later.",
            },
            {
              n: 2,
              title: "AI summarizes them",
              desc: "Claude AI reads the transcript and generates structured summaries with key points and tags. Skip the ads and filler.",
            },
            {
              n: 3,
              title: "Read your summary",
              desc: "Get the gist in seconds. Search, filter, and export your summaries anytime.",
            },
          ].map((step) => (
            <div
              key={step.n}
              className="text-center border-2 border-(--color-border-hard) rounded-xl p-6 shadow-brutal bg-(--color-surface)"
            >
              <div className="inline-flex items-center justify-center w-9 h-9 bg-[#fff0f6] text-neon-700 font-bold rounded-full border-2 border-(--color-border-hard) mb-3">
                {step.n}
              </div>
              <h3 className="text-base font-semibold mb-2">{step.title}</h3>
              <p className="text-sm text-(--color-text-muted) leading-relaxed m-0">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="py-12">
        <h2 className="text-2xl font-bold tracking-tight text-center mb-8">Pricing</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl mx-auto">
          <div className="border-2 border-(--color-border-hard) rounded-xl p-6 shadow-brutal bg-(--color-surface)">
            <h3 className="text-xl font-bold mb-1">Free</h3>
            <p className="text-2xl font-bold mb-4">$0</p>
            <ul className="list-none p-0 m-0 space-y-2">
              {["5 summaries / month", "7-day summary history", "Basic summaries"].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-(--color-text-body)">
                  <span className="text-neon-700 font-bold">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-2 border-(--color-border-hard) rounded-xl p-6 shadow-brutal bg-[#fff0f6] dark:bg-neon-900/30">
            <h3 className="text-xl font-bold mb-1">
              Pro{" "}
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-neon-100 text-neon-800 uppercase tracking-wide ml-1">
                PRO
              </span>
            </h3>
            <p className="text-2xl font-bold mb-4">
              $7 <span className="text-sm font-medium text-(--color-text-muted)">/ month</span>
            </p>
            <ul className="list-none p-0 m-0 space-y-2">
              {[
                "100 summaries / month",
                "Unlimited history",
                "Batch queue",
                "Deep dive mode",
                "Custom prompts",
                "Export summaries",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-(--color-text-body)">
                  <span className="text-neon-700 font-bold">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Refund */}
      <section className="py-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--color-text-muted) mb-1">
          Cancellation & Refunds
        </h2>
        <p className="text-sm text-(--color-text-faint) max-w-2xl leading-relaxed">
          Cancel anytime from the extension. You keep Pro access until the end of your billing
          period. No refunds for partial periods. Charged in error?{" "}
          <a href="mailto:cliphy.ai+support@gmail.com" className="text-neon-700 hover:underline">
            Let us know.
          </a>
        </p>
      </section>

      {/* Footer */}
      <footer className="mt-8 py-4 border-t-2 border-(--color-border-soft) flex flex-wrap items-center justify-between gap-3 text-xs text-(--color-text-faint)">
        <div className="flex gap-5 flex-wrap">
          <a href="/terms" className="text-(--color-text-muted) hover:text-neon-700 no-underline">
            Terms of Service
          </a>
          <a href="/privacy" className="text-(--color-text-muted) hover:text-neon-700 no-underline">
            Privacy Policy
          </a>
          <a
            href="mailto:cliphy.ai+support@gmail.com"
            className="text-(--color-text-muted) hover:text-neon-700 no-underline"
          >
            cliphy.ai+support@gmail.com
          </a>
        </div>
        <p className="m-0">&copy; 2026 Cliphy. All rights reserved.</p>
      </footer>
    </div>
  );
}

function ChromeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 63 63" fill="none">
      <defs>
        <linearGradient
          id="cg"
          gradientUnits="userSpaceOnUse"
          x1="34.91"
          x2="7.63"
          y1="61.03"
          y2="13.78"
        >
          <stop offset="0" stopColor="#1e8e3e" />
          <stop offset="1" stopColor="#34a853" />
        </linearGradient>
        <linearGradient
          id="cy"
          gradientUnits="userSpaceOnUse"
          x1="26.9"
          x2="54.18"
          y1="63.08"
          y2="15.83"
        >
          <stop offset="0" stopColor="#fcc934" />
          <stop offset="1" stopColor="#fbbc04" />
        </linearGradient>
        <linearGradient
          id="cr"
          gradientUnits="userSpaceOnUse"
          x1="4.22"
          x2="58.77"
          y1="19.69"
          y2="19.69"
        >
          <stop offset="0" stopColor="#d93025" />
          <stop offset="1" stopColor="#ea4335" />
        </linearGradient>
      </defs>
      <circle cx="31.5" cy="31.5" r="15.75" fill="#fff" />
      <path
        d="m17.86 39.38-13.64-23.62A31.5 31.5 0 0 0 31.5 63l13.64-23.62a15.75 15.75 0 0 1-27.28.0z"
        fill="url(#cg)"
      />
      <path
        d="m45.14 39.37-13.64 23.62A31.5 31.5 0 0 0 58.77 15.75H31.5a15.75 15.75 0 0 1 13.64 23.62z"
        fill="url(#cy)"
      />
      <circle cx="31.5" cy="31.5" r="12.47" fill="#1a73e8" />
      <path
        d="M31.5 15.75h27.27A31.5 31.5 0 0 0 4.22 15.75l13.64 23.62a15.75 15.75 0 0 1 13.64-23.62z"
        fill="url(#cr)"
      />
    </svg>
  );
}
