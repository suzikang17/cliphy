/**
 * One-time pass, after refetch-tweets: tweets that were saved as only their
 * opening had their summary and tags written from that opening. Write the
 * summary again from the full text.
 *
 * Only tweets longer than the old cut could hold are redone. Tags already on a
 * clip are kept (new ones are added); a category already set is kept.
 *
 * Reads only by default (and calls no model). Pass --apply to write.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… ANTHROPIC_API_KEY=… \
 *     tsx scripts/resummarize-tweets.ts [--apply]
 *
 * Prints clip ids and lengths only, never the words of a post or summary.
 */
import { createClient } from "@supabase/supabase-js";
import { MAX_TAGS_PER_SUMMARY } from "@cliphy/shared";
import { enrichClip } from "../src/services/enrich.js";
import { mergeTags } from "../src/services/tagger.js";

const APPLY = process.argv.includes("--apply");
/** X's embed endpoint cut long posts at about 280 characters (up to ~304 with a link). */
const LONGER_THAN_THE_CUT = 320;
const PAUSE_MS = 300;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
if (APPLY && !process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required to write summaries.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

interface Row {
  id: string;
  user_id: string;
  video_title: string | null;
  content: string | null;
  tags: string[] | null;
  category: string | null;
  summary_json: { summary?: string } | null;
}

/** Each person's own tags, so new tags come from the words they already use. */
const vocab = new Map<string, string[]>();
async function tagsOf(userId: string): Promise<string[]> {
  const known = vocab.get(userId);
  if (known) return known;
  const { data } = await supabase
    .from("clips")
    .select("tags")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .limit(500);
  const tags = [...new Set((data ?? []).flatMap((r) => (r.tags as string[] | null) ?? []))];
  vocab.set(userId, tags);
  return tags;
}

async function main() {
  const { data, error } = await supabase
    .from("clips")
    .select("id, user_id, video_title, content, tags, category, summary_json")
    .eq("source_type", "tweet")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not list tweets: ${error.message}`);
  const all = (data ?? []) as Row[];
  const rows = all.filter((r) => (r.content ?? "").length > LONGER_THAN_THE_CUT);
  console.log(
    `${all.length} saved tweet(s); ${rows.length} longer than the old cut. ` +
      (APPLY ? "Writing summaries." : "Dry run: no model is called, nothing is written."),
  );

  const tally = { rewritten: 0, tagsAdded: 0, failed: 0 };
  for (const row of rows) {
    const short = row.id.slice(0, 8);
    const length = (row.content ?? "").length;
    if (!APPLY) {
      console.log(
        `  ${short}  ${length} chars, summary now ${row.summary_json?.summary?.length ?? 0} chars`,
      );
      continue;
    }
    try {
      const e = await enrichClip({
        sourceType: "tweet",
        title: row.video_title ?? undefined,
        text: row.content ?? "",
        existingTags: await tagsOf(row.user_id),
      });
      if (!e.summary) throw new Error("the model returned no summary");
      const before = row.tags ?? [];
      const tags = mergeTags(before, e.tags, MAX_TAGS_PER_SUMMARY);
      const { error: writeError } = await supabase
        .from("clips")
        .update({
          summary_json: { summary: e.summary, keyPoints: [], timestamps: [] },
          tags,
          ...(row.category ? {} : { category: e.category }),
        })
        .eq("id", row.id);
      if (writeError) throw new Error(writeError.message);
      tally.rewritten += 1;
      tally.tagsAdded += tags.length - before.length;
      console.log(
        `  ${short}  ${length} chars → summary ${row.summary_json?.summary?.length ?? 0} → ${e.summary.length} chars, +${tags.length - before.length} tag(s)`,
      );
    } catch (err) {
      tally.failed += 1;
      console.log(`  ${short}  failed: ${err instanceof Error ? err.message : "Error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }

  if (APPLY) {
    console.log("");
    console.log(`Summaries rewritten:  ${tally.rewritten}`);
    console.log(`Tags added:           ${tally.tagsAdded}`);
    console.log(`Failed (left as is):  ${tally.failed}`);
    if (tally.failed > 0) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
