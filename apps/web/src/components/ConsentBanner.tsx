import { useState } from "react";
import { allowAnalytics, consentStatus, declineAnalytics } from "../lib/analytics";

/** Asks once whether analytics may run. Gone for good after either answer. */
export function ConsentBanner() {
  const [status, setStatus] = useState(consentStatus);
  if (status !== "pending") return null;

  const button =
    "text-sm font-bold px-4 py-2 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer transition-all";

  return (
    <div
      role="region"
      aria-label="Analytics choice"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:max-w-sm z-50 p-4 border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm bg-(--color-surface)"
    >
      <p className="text-sm m-0 mb-3">
        May we use analytics to see how this site is used? Nothing you type or save is recorded.{" "}
        <a href="/privacy" className="underline">
          Privacy policy
        </a>
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className={`${button} bg-neon-500 text-black`}
          onClick={() => {
            allowAnalytics();
            setStatus(consentStatus());
          }}
        >
          Allow
        </button>
        <button
          type="button"
          className={button}
          onClick={() => {
            declineAnalytics();
            setStatus(consentStatus());
          }}
        >
          No thanks
        </button>
      </div>
    </div>
  );
}
