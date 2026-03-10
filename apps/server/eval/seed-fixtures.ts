/**
 * Seed eval fixtures by fetching transcripts from YouTube.
 * Run once: npx tsx apps/server/eval/seed-fixtures.ts
 */
import { fetchTranscript } from "../src/services/transcript.js";
import { saveFixture } from "./fixtures.js";

const VIDEOS = [
  {
    videoId: "_Q4XT82yd-Q",
    title:
      "The Most Effective Weight Training, Cardio & Nutrition for Women | Dr. Lauren Colenso-Semple",
    category: "long",
  },
  {
    videoId: "0d3VPmXiz-Y",
    title: "Kash Patel, Into Iran, & A Missing Leg | The Tim Dillon Show #485",
    category: "long",
  },
  {
    videoId: "8jPQjjsBbIc",
    title: "How to stay calm when you know you'll be stressed | Daniel Levitin TED",
    category: "lecture",
  },
  { videoId: "dQw4w9WgXcQ", title: "Rick Astley - Never Gonna Give You Up", category: "music" },
  {
    videoId: "wBlIaazbQ2U",
    title: "Epic Gardening - Growing Potatoes 8 Ways",
    category: "explainer",
  },
  {
    videoId: "MnrJzXM7a6o",
    title: "Steve Jobs introduces iPhone at Macworld 2007",
    category: "lecture",
  },
  {
    videoId: "yWaYdGQqxQU",
    title: "How to Make 3-Ingredient Stovetop Macaroni and Cheese",
    category: "cooking",
  },
];

async function main() {
  console.log("Seeding eval fixtures...\n");
  let success = 0;
  let failed = 0;

  for (const video of VIDEOS) {
    process.stdout.write(`  ${video.title}... `);
    try {
      const { text: transcript, durationSeconds } = await fetchTranscript(video.videoId);
      const path = saveFixture({ ...video, durationSeconds, transcript });
      console.log(`OK (${transcript.length} chars, ${durationSeconds ?? "?"}s) → ${path}`);
      success++;
    } catch (err) {
      console.log(`FAIL: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} saved, ${failed} failed.`);
}

main();
