/**
 * One-time pass over saved tweets: read each post again and fill in the ones
 * saved as only their opening (before ADR 0071), and correct the "cut" mark.
 *
 * Reads only by default. Pass --apply to write.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… tsx scripts/refetch-tweets.ts [--apply]
 *
 * Prints clip ids and lengths only, never the words of a post.
 */
import { createClient } from "@supabase/supabase-js";
import { extractTweetClip } from "../src/services/extractors/tweet.js";
import {
  refetchedTweetPatch,
  unreadableTweetPatch,
  type StoredTweet,
  type TweetPatch,
} from "../src/services/refetchTweet.js";

const APPLY = process.argv.includes("--apply");
const PAUSE_MS = 400;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

type Row = StoredTweet & { id: string; source_url: string | null };

async function main() {
  const { data, error } = await supabase
    .from("clips")
    .select("id, source_url, content, source_metadata")
    .eq("source_type", "tweet")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not list tweets: ${error.message}`);
  const rows = (data ?? []) as Row[];
  console.log(
    `${rows.length} saved tweet(s). ${APPLY ? "Writing changes." : "Dry run: nothing is written."}`,
  );

  const tally = { filled: 0, markFixed: 0, unchanged: 0, unreadable: 0, failedWrite: 0 };
  let charsBefore = 0;
  let charsAfter = 0;

  for (const row of rows) {
    const short = row.id.slice(0, 8);
    let patch: TweetPatch | null;
    let readable = true;
    try {
      if (!row.source_url) throw new Error("no address");
      patch = refetchedTweetPatch(row, await extractTweetClip(row.source_url));
    } catch {
      readable = false;
      patch = unreadableTweetPatch(row);
    }

    if (!readable) tally.unreadable += 1;
    if (!patch) {
      if (readable) tally.unchanged += 1;
    } else {
      if (patch.content !== undefined) {
        tally.filled += 1;
        charsBefore += (row.content ?? "").length;
        charsAfter += patch.content.length;
        console.log(`  ${short}  ${(row.content ?? "").length} → ${patch.content.length} chars`);
      } else {
        tally.markFixed += 1;
      }
      if (APPLY) {
        const { error: writeError } = await supabase.from("clips").update(patch).eq("id", row.id);
        if (writeError) {
          tally.failedWrite += 1;
          console.log(`  ${short}  write failed: ${writeError.message}`);
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }

  console.log("");
  console.log(
    `Filled in:            ${tally.filled}  (${charsBefore} → ${charsAfter} characters in all)`,
  );
  console.log(`Cut mark corrected:   ${tally.markFixed}`);
  console.log(`Already right:        ${tally.unchanged}`);
  console.log(`Could not be read:    ${tally.unreadable}  (deleted or protected; left as saved)`);
  if (APPLY) console.log(`Writes that failed:   ${tally.failedWrite}`);
  if (tally.failedWrite > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
