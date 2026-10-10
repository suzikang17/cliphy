import type { ClosedGroup, ClosedGroupPage } from "@cliphy/shared";
import { supabase } from "../lib/supabase.js";

// What was open when a Tabs-view group was closed, so it can be resumed.
// Address + title only; one row per user+group (a later close replaces it).

export const MAX_CLOSED_PAGES = 100;

const toGroup = (r: Record<string, unknown>): ClosedGroup => ({
  key: r.group_key as string,
  label: r.label as string,
  pages: (r.pages as ClosedGroupPage[]) ?? [],
  closedAt: r.closed_at as string,
});

export async function closeGroup(
  userId: string,
  key: string,
  label: string,
  pages: ClosedGroupPage[],
): Promise<{ closedAt: string }> {
  const closedAt = new Date().toISOString();
  const { error } = await supabase.from("closed_groups").upsert(
    {
      user_id: userId,
      group_key: key,
      label,
      pages: pages.slice(0, MAX_CLOSED_PAGES),
      closed_at: closedAt,
    },
    { onConflict: "user_id,group_key" },
  );
  if (error) throw new Error("Failed to save closed group");
  return { closedAt };
}

export async function listClosedGroups(userId: string): Promise<ClosedGroup[]> {
  const { data, error } = await supabase
    .from("closed_groups")
    .select("*")
    .eq("user_id", userId)
    .order("closed_at", { ascending: false });
  if (error) throw new Error("Failed to list closed groups");
  return (data ?? []).map((r) => toGroup(r as Record<string, unknown>));
}

/** Returns the snapshot and removes it — resuming consumes the closed group. */
export async function resumeGroup(userId: string, key: string): Promise<ClosedGroup | null> {
  const { data } = await supabase
    .from("closed_groups")
    .delete()
    .eq("user_id", userId)
    .eq("group_key", key)
    .select("*");
  return data?.[0] ? toGroup(data[0] as Record<string, unknown>) : null;
}
