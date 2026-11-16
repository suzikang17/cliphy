import type { RunBrief } from "../contract.js";

export const RUN_ID = "3f9a1c2e-0000-4000-8000-000000000001";

/** The fictional client Maren and her project Alder House. */
export const brief = (over: Partial<RunBrief> = {}): RunBrief => ({
  runId: RUN_ID,
  repo: "example/alder-house",
  siteUrl: "https://alderhouse.example",
  understood: "Maren asked for the sconce photos to move up on page 2.",
  answer: "Only the photos",
  task: {
    title: "Move the sconces up on page 2",
    kit: {
      materials: ["The Lighting page"],
      doneWhen: "The sconce photos sit above the paragraph.",
    },
  },
  messages: [
    {
      direction: "in",
      text: "can the sconces go higher on page 2",
      sentAt: "2026-11-14T09:00:00Z",
      imageUrls: ["https://signed.example/sconces.png"],
    },
    { direction: "out", text: "sure, on it", sentAt: "2026-11-14T09:01:00Z", imageUrls: [] },
  ],
  ...over,
});
