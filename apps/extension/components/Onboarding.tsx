interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  return (
    <div className="p-4">
      <h2 className="text-lg font-extrabold m-0 mb-4">You're in!</h2>

      <div className="bg-(--color-accent-surface) rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <span className="text-2xl shrink-0">🎬</span>
          <div>
            <p className="text-sm font-bold m-0 mb-1">
              Go to a YouTube video and click "Add to Queue"
            </p>
            <p className="text-xs text-(--color-text-muted) m-0">
              Cliphy will generate an AI summary in ~30 seconds
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={onComplete}
        className="w-full py-2.5 text-sm bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down font-bold cursor-pointer"
      >
        Got it &rarr;
      </button>
    </div>
  );
}
