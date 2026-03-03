interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/40">
      <div className="bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal p-5 w-full max-w-sm">
        <h2 className="text-lg font-extrabold m-0 mb-4">You're all set!</h2>
        <ol className="list-none p-0 m-0 mb-6 space-y-2.5">
          <li className="flex items-center gap-3 text-sm">
            <span className="w-6 h-6 rounded-full bg-neon-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
              1
            </span>
            Open any YouTube video
          </li>
          <li className="flex items-center gap-3 text-sm">
            <span className="w-6 h-6 rounded-full bg-neon-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
              2
            </span>
            Click "Add to Queue"
          </li>
          <li className="flex items-center gap-3 text-sm">
            <span className="w-6 h-6 rounded-full bg-neon-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
              3
            </span>
            Get a summary in ~30s
          </li>
        </ol>

        <button
          onClick={onComplete}
          className="w-full py-2.5 text-sm bg-neon-600 text-white border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down font-bold cursor-pointer"
        >
          Got it &rarr;
        </button>
      </div>
    </div>
  );
}
