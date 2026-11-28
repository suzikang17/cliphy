/**
 * Read-only: what saved posts (tweets) carry for a picture, as counts.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… tsx scripts/tweet-media-check.ts
 *
 * Prints counts only: no text, links, handles or accounts.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data, error } = await supabase
    .from("clips")
    .select("status, hero_image_url, source_metadata, content, created_at")
    .eq("source_type", "tweet")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const tally = new Map<string, number>();
  const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
  for (const r of rows) {
    const meta = (r.source_metadata ?? {}) as Record<string, unknown>;
    const media = Array.isArray(meta.media) ? (meta.media as Record<string, unknown>[]) : null;
    bump(`status ${r.status}`);
    bump(`metadata keys: ${Object.keys(meta).sort().join(",") || "(none)"}`);
    bump(media === null ? "media: missing" : `media: ${media.length} item(s)`);
    if (media?.[0]) {
      const m = media[0];
      bump(
        `first media: type=${m.type} url=${m.url ? "yes" : "no"} previewUrl=${m.previewUrl ? "yes" : "no"}`,
      );
    }
    bump(`hero_image_url: ${r.hero_image_url ? "yes" : "no"}`);
    bump(`content: ${r.content ? "yes" : "no"}`);
  }
  console.log(`${rows.length} saved post(s)`);
  for (const [k, n] of [...tally].sort()) console.log(`  ${n}  ${k}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
