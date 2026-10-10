import { inngest } from "../lib/inngest.js";
import { toClip, toPinnedItem } from "../lib/mappers.js";
import { supabase } from "../lib/supabase.js";
import { detectSourceType } from "./detectSourceType.js";
import { extractWebMetadata } from "./extractors/webMetadata.js";
import { pageKey, tagsForPages } from "./page-tags.js";

export interface PinPageInput {
  userId: string;
  url: string;
  /** Your name for the page (Tabs view), else the page's own title. */
  title?: string;
  note?: string;
}

/**
 * Pin a page: find-or-create a bookmark-tier clip (an existing clip for the URL,
 * any tier, is reused), carry the page's tag + your name/note into it, drop the
 * page from the Trail (it's kept as a clip now — retention can't touch it), and
 * pin the clip once. Idempotent.
 */
export async function pinPage({ userId, url, title, note }: PinPageInput) {
  const { data: existing } = await supabase
    .from("clips")
    .select("*")
    .eq("user_id", userId)
    .eq("source_url", url)
    .is("deleted_at", null)
    .maybeSingle();

  let clipRow = existing as Record<string, unknown> | null;
  if (!clipRow) {
    let md: Awaited<ReturnType<typeof extractWebMetadata>>;
    try {
      md = await extractWebMetadata(url);
    } catch {
      md = { title: url };
    }
    const tag = (await tagsForPages(userId, [url])).get(url);
    const { data, error } = await supabase
      .from("clips")
      .insert({
        user_id: userId,
        source_type: detectSourceType(url),
        source_url: url,
        enrichment_tier: "metadata",
        video_title: title || md.title || url,
        hero_image_url: md.heroImageUrl ?? null,
        source_metadata: { siteName: md.siteName, faviconUrl: md.faviconUrl },
        status: "completed",
        tags: tag ? [tag] : [],
        ...(note && { user_notes: note }),
      })
      .select("*")
      .single();
    if (error || !data) throw new Error("Failed to save clip");
    clipRow = data as Record<string, unknown>;
    await inngest
      .send({ name: "clip/embed.requested", data: { clipId: data.id as string } })
      .catch(() => {});
  }

  // Kept as a clip now → out of the Trail (trail_items.url is the normalized page key).
  await supabase.from("trail_items").delete().eq("user_id", userId).eq("url", pageKey(url));

  const clipId = clipRow.id as string;
  const { data: pinExisting } = await supabase
    .from("pinned_items")
    .select("*")
    .eq("user_id", userId)
    .eq("clip_id", clipId)
    .maybeSingle();
  if (pinExisting) {
    return {
      pin: toPinnedItem(pinExisting as Record<string, unknown>),
      clip: toClip(clipRow),
      created: false,
    };
  }
  const { data: pin, error: pinErr } = await supabase
    .from("pinned_items")
    .insert({ user_id: userId, kind: "clip", layout: "tile", position: 0, clip_id: clipId })
    .select("*")
    .single();
  if (pinErr || !pin) throw new Error("Failed to create pin");
  return {
    pin: toPinnedItem(pin as Record<string, unknown>),
    clip: toClip(clipRow),
    created: true,
  };
}
