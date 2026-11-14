import { supabase } from "../../lib/supabase.js";

const PREFIX = "project:";

/** "Alder House!" → "project:alder-house". A name with nothing sluggable gives the bare prefix. */
export function projectTag(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${PREFIX}${slug}`;
}

/** "project:alder-house" → "Alder house". */
export function projectNameFromTag(tag: string): string {
  const words = tag.slice(PREFIX.length).replace(/-+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Create a project record for every existing `project:` tag the user has (in
 * tag hints or on clips), so clips already tagged show up in their project.
 * Idempotent. Returns the number of projects created.
 */
export async function seedProjectsFromTags(userId: string): Promise<number> {
  const [{ data: hintRows }, { data: clipRows }] = await Promise.all([
    supabase.from("tag_hints").select("tag").eq("user_id", userId).like("tag", `${PREFIX}%`),
    supabase.from("clips").select("tags").eq("user_id", userId).is("deleted_at", null).limit(2000),
  ]);

  const tags = new Set<string>();
  for (const r of (hintRows ?? []) as { tag: string }[]) tags.add(r.tag);
  for (const r of (clipRows ?? []) as { tags: string[] | null }[]) {
    for (const t of r.tags ?? []) tags.add(t);
  }
  const projectTags = [...tags].filter((t) => t.startsWith(PREFIX) && t.length > PREFIX.length);
  if (projectTags.length === 0) return 0;

  const { data } = await supabase
    .from("coach_projects")
    .upsert(
      projectTags.map((tag) => ({ user_id: userId, tag, name: projectNameFromTag(tag) })),
      { onConflict: "user_id,tag", ignoreDuplicates: true },
    )
    .select("id");
  return ((data as unknown[]) ?? []).length;
}
