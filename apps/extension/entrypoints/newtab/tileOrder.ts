/** Reorder tile ids after a drag. Pure, so the drag UI stays trivially testable. */
export function moveTile(ids: string[], from: number, to: number): string[] {
  if (from === to) return [...ids];
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
