/**
 * Seed eval fixtures by fetching transcripts from YouTube.
 * Run once: npx tsx apps/server/eval/seed-fixtures.ts
 */
import { fetchTranscript } from "../src/services/transcript.js";
import { saveFixture } from "./fixtures.js";

const VIDEOS = [
  { videoId: "jNQXAC9IVRw", title: "Me at the zoo", category: "short" },
  { videoId: "8jPQjjsBbIc", title: "Fireship - 100 seconds of code", category: "tutorial" },
  { videoId: "dQw4w9WgXcQ", title: "Rick Astley - Never Gonna Give You Up", category: "music" },
  { videoId: "hY7m5jjJ9mM", title: "CSS in 100 Seconds", category: "tutorial" },
  {
    videoId: "pTB0EiLXUC8",
    title: "Do schools kill creativity? - Ken Robinson TED",
    category: "lecture",
  },
  { videoId: "UF8uR6Z6KLc", title: "Steve Jobs Stanford Commencement", category: "lecture" },
  {
    videoId: "MnrJzXM7a6o",
    title: "How The Economic Machine Works - Ray Dalio",
    category: "explainer",
  },
  {
    videoId: "arj7oStGLkU",
    title: "Tim Urban: Inside the mind of a master procrastinator TED",
    category: "lecture",
  },
  {
    videoId: "rfscVS0vtbw",
    title: "Python Tutorial for Beginners (first 100k chars)",
    category: "long",
  },
  {
    videoId: "PkZNo7MFNFg",
    title: "JavaScript Tutorial for Beginners (first 100k chars)",
    category: "long",
  },
];

async function main() {
  console.log("Seeding eval fixtures...\n");
  let success = 0;
  let failed = 0;

  for (const video of VIDEOS) {
    process.stdout.write(`  ${video.title}... `);
    try {
      const transcript = await fetchTranscript(video.videoId);
      const path = saveFixture({ ...video, transcript });
      console.log(`OK (${transcript.length} chars) → ${path}`);
      success++;
    } catch (err) {
      console.log(`FAIL: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} saved, ${failed} failed.`);
}

main();
