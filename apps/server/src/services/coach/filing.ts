/** How sure the bot is about where something belongs. */
export type FilingTier = "sure" | "fairly" | "unsure";

/** A stated focus this recent is taken at its word. */
const SURE_WITHIN_MS = 6 * 60 * 60_000;
/** Older than that but still today-ish: a good guess, shown with a way to change it. */
const FAIRLY_WITHIN_MS = 24 * 60 * 60_000;

/**
 * Which project a progress photo belongs to, and how sure that is.
 *
 * - sure: she said what she is working on in the last few hours.
 * - fairly: an older focus, or there is only one project it could be.
 * - unsure: anything else. The bot asks; it does not guess between projects.
 */
export function fileProgress(input: {
  focus: { projectId: string; setAt: string } | null;
  activeProjects: string[];
  now: Date;
}): { projectId: string | null; tier: FilingTier } {
  const { focus, activeProjects, now } = input;

  if (focus && activeProjects.includes(focus.projectId)) {
    const age = now.getTime() - Date.parse(focus.setAt);
    if (age < SURE_WITHIN_MS) return { projectId: focus.projectId, tier: "sure" };
    if (age < FAIRLY_WITHIN_MS) return { projectId: focus.projectId, tier: "fairly" };
  }
  if (activeProjects.length === 1) return { projectId: activeProjects[0], tier: "fairly" };
  return { projectId: null, tier: "unsure" };
}
