/**
 * Smoke test: hit POST /api/summarize with real YouTube videos.
 *
 * Usage:
 *   1. Start server: pnpm dev:server
 *   2. Run this:     pnpm --filter server tsx scripts/smoke-test-summary.ts
 */

const VIDEOS = [
  { videoId: "jNQXAC9IVRw", title: "Me at the zoo", type: "short" },
  {
    videoId: "8jPQjjsBbIc",
    title: "Fireship - 100 seconds of code",
    type: "tutorial",
  },
  {
    videoId: "dQw4w9WgXcQ",
    title: "Rick Astley - Never Gonna Give You Up",
    type: "music",
  },
];

const API_URL = process.env.API_URL ?? "http://localhost:3000";

async function test(video: (typeof VIDEOS)[number]) {
  console.log(`\n--- Testing: ${video.title} (${video.type}) ---`);
  const start = Date.now();

  try {
    const res = await fetch(`${API_URL}/api/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId: video.videoId,
        videoTitle: video.title,
      }),
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (!res.ok) {
      const err = await res.json();
      console.log(`  FAIL (${elapsed}s): ${res.status} — ${err.error}`);
      return;
    }

    const data = (await res.json()) as {
      summary: string;
      keyPoints: string[];
      timestamps: string[];
    };
    console.log(`  OK (${elapsed}s)`);
    console.log(`  Summary: ${data.summary.slice(0, 150)}...`);
    console.log(`  Key points: ${data.keyPoints.length}`);
    console.log(`  Timestamps: ${data.timestamps.length}`);
  } catch (err) {
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  console.log("Smoke testing POST /api/summarize");
  console.log(`Target: ${API_URL}`);
  for (const video of VIDEOS) {
    await test(video);
  }
  console.log("\nDone.");
}

main();
