// What the runner and the Cliphy API say to each other: claim, check in,
// finish. The runner keeps its own copy of these shapes so that it depends on
// nothing but the three calls; `packages/shared/src/coach.ts` holds the
// server's side of the same contract.

export interface RunBrief {
  runId: string;
  /** `owner/name` on GitHub. */
  repo: string;
  /** The live site, for the "before" picture. */
  siteUrl: string | null;
  /** The request as the coach understood it, and the answer to its question if there was one. */
  understood: string;
  answer: string | null;
  task: {
    title: string;
    kit: { materials?: string[]; target?: string; doneWhen?: string; draft?: string };
  };
  /** The request's original messages, oldest first, with short-lived image addresses. */
  messages: { direction: "in" | "out"; text: string; sentAt: string; imageUrls: string[] }[];
}

export interface RunPicture {
  label: "before" | "after";
  width: "phone" | "desktop";
  storagePath: string;
}

export interface RunOutcome {
  status: "done" | "failed";
  summary?: string;
  branch?: string;
  prUrl?: string;
  previewUrl?: string;
  pictures?: RunPicture[];
  error?: string;
}

export const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
