export function ErrorFallback() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-center">
      <p className="text-sm font-bold">Something went wrong</p>
      <p className="text-xs text-(--color-text-faint) mt-1">An unexpected error occurred.</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-3 text-xs font-bold px-4 py-2 bg-(--color-surface) border-2 border-(--color-border-hard) rounded-lg shadow-brutal-sm hover:shadow-brutal-pressed press-down cursor-pointer"
      >
        Reload
      </button>
    </div>
  );
}
