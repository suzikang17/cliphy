const WORDS = 4;

/**
 * The branch a run works on: `cliphy/<start of the run id>-<first words of the
 * title>`. Only ever letters, digits and dashes after the prefix, whatever the
 * id or title contain, because it ends up on a git command line.
 */
export function branchName(runId: string, title: string): string {
  const id = runId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, WORDS);
  return `cliphy/${id}-${words.length ? words.join("-") : "change"}`;
}
