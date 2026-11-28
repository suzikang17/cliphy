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
  const age = (iso: string) =>
    `${Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000)} h`;
  const sorted = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  console.log("newest 10, as age · status · has text · has picture:");
  for (const r of sorted.slice(0, 10)) {
    const meta = (r.source_metadata ?? {}) as { media?: { previewUrl?: string; url?: string }[] };
    const pic = !!(meta.media?.[0]?.previewUrl || r.hero_image_url);
    console.log(
      `  ${age(r.created_at as string)} · ${r.status} · ${r.content ? "text" : "NO text"} · ${pic ? "picture" : "no picture"}`,
    );
  }
  const { data: web } = await supabase
    .from("clips")
    .select("status, created_at, updated_at")
    .eq("source_type", "web")
    .is("deleted_at", null)
    .gte("created_at", "2026-11-23T02:54:00Z");
  console.log(`articles saved since the background read went in: ${web?.length ?? 0}`);
  for (const w of web ?? []) console.log(`  ${age(w.created_at as string)} · ${w.status}`);
  const { data: recent } = await supabase
    .from("clips")
    .select("source_type, status, created_at, updated_at")
    .is("deleted_at", null)
    .gte("created_at", "2026-11-22T00:00:00Z")
    .order("created_at", { ascending: false });
  console.log(
    `every clip saved since Nov 22: ${recent?.length ?? 0} (age · type · status · last change)`,
  );
  for (const r of recent ?? [])
    console.log(
      `  ${age(r.created_at as string)} · ${r.source_type} · ${r.status} · ${age(r.updated_at as string)}`,
    );
  console.log(`${rows.length} saved post(s)`);
  for (const [k, n] of [...tally].sort()) console.log(`  ${n}  ${k}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
