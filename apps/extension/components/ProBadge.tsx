/** Small "Pro" badge shown next to gated features. */
export function ProBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 select-none ${className}`}
    >
      <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
        <path d="M8 1l2.35 4.76 5.26.77-3.8 3.7.9 5.24L8 13.07l-4.71 2.4.9-5.24-3.8-3.7 5.26-.77z" />
      </svg>
      Pro
    </span>
  );
}
