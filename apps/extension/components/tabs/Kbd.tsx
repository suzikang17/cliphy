/** A small key-cap chip used to label shortcuts. */
export function Kbd({ children, className = "" }: { children: string; className?: string }) {
  return (
    <kbd
      className={`ml-1 inline-block rounded border border-(--color-border-soft) bg-(--color-surface) px-1 font-mono text-[9px] font-bold leading-[14px] text-(--color-text-faint) ${className}`}
    >
      {children}
    </kbd>
  );
}
