// A project's tag: its identity, made from its name. Kept apart from the
// database code so messages and tests can use it on its own.

export const PREFIX = "project:";

/** "Alder House!" → "project:alder-house". A name with nothing sluggable gives the bare prefix. */
export function projectTag(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${PREFIX}${slug}`;
}
