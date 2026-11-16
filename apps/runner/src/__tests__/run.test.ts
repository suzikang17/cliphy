import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { runOnce, CLAUDE_LIMIT_MS, PREVIEW_LIMIT_MS, type RunDeps } from "../run.js";
import type { RunOutcome } from "../contract.js";
import { brief, RUN_ID } from "./fixtures.js";

const BRANCH = "cliphy/3f9a1c2e-move-the-sconces-up";
const PR = "https://github.com/example/alder-house/pull/3";
const PREVIEW = "https://3f9a1c2e.alder-house.pages.dev";
const answer = {
  summary: "Moved the sconce photos above the paragraph.",
  paths: ["/lighting", "/"],
};
const stdout = (a: unknown = answer) => JSON.stringify({ type: "result", structured_output: a });

interface World {
  queued?: boolean;
  brief?: ReturnType<typeof brief>;
  claude?: Awaited<ReturnType<RunDeps["claude"]>>;
  changed?: boolean;
  preview?: string | null;
  /** The check-in (1 = first) from which the server says the run was stopped. */
  cancelledFrom?: number;
  fail?: Partial<Record<"prepare" | "collect" | "publish" | "shoot" | "upload", boolean>>;
}

function fake(w: World = {}) {
  const calls: string[] = [];
  const finished: RunOutcome[] = [];
  const published: { title: string; body: string; branch: string }[] = [];
  const shots: string[] = [];
  let checkIns = 0;
  const boom = (what: keyof NonNullable<World["fail"]>) => {
    if (w.fail?.[what]) throw new Error(`${what} broke`);
  };
  const deps: RunDeps = {
    api: {
      claim: async () => {
        calls.push("claim");
        return w.queued === false ? null : { run: { id: RUN_ID }, brief: w.brief ?? brief() };
      },
      checkIn: async (_id, note) => {
        checkIns += 1;
        calls.push(`checkIn:${note}`);
        return { cancelled: w.cancelledFrom !== undefined && checkIns >= w.cancelledFrom };
      },
      finish: async (_id, outcome) => {
        calls.push("finish");
        finished.push(outcome);
      },
      upload: async () => {
        boom("upload");
        return `coach/u/${shots.length}.png`;
      },
    },
    repo: {
      prepare: async (_repo, branch) => {
        calls.push(`prepare:${branch}`);
        boom("prepare");
        return { workDir: "/work/example__alder-house" };
      },
      collect: async () => {
        calls.push("collect");
        boom("collect");
        return { changed: w.changed ?? true };
      },
      publish: async (_repo, branch, title, body) => {
        calls.push("publish");
        boom("publish");
        published.push({ branch, title, body });
        return { prUrl: PR };
      },
      discard: async () => {
        calls.push("discard");
      },
    },
    claude: async (_dir, _prompt, limitMs, alive) => {
      calls.push(`claude:${limitMs}`);
      if (!(await alive())) return { ok: false, reason: "stopped", detail: "" };
      return w.claude ?? { ok: true, stdout: stdout() };
    },
    preview: async (_repo, _branch, limitMs, alive) => {
      calls.push(`preview:${limitMs}`);
      if (!(await alive())) return null;
      return w.preview === undefined ? PREVIEW : w.preview;
    },
    shoot: async (url, width) => {
      boom("shoot");
      shots.push(`${width} ${url}`);
      return Buffer.from("png");
    },
    log: () => {},
  };
  return { deps, calls, finished, published, shots };
}

describe("one run, start to finish", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Runner");
  });

  it("does nothing when nothing is queued", async () => {
    const f = fake({ queued: false });
    expect(await runOnce(f.deps)).toBe("idle");
    expect(f.calls).toEqual(["claim"]);
  });

  it("prepares, lets Claude work, publishes, waits for the preview, takes pictures, finishes", async () => {
    const f = fake();
    expect(await runOnce(f.deps)).toBe("done");
    expect(f.calls).toEqual([
      "claim",
      `prepare:${BRANCH}`,
      `claude:${CLAUDE_LIMIT_MS}`,
      "checkIn:working on it",
      "collect",
      "checkIn:opening the pull request",
      "publish",
      `preview:${PREVIEW_LIMIT_MS}`,
      "checkIn:waiting for the preview",
      "checkIn:taking pictures",
      "finish",
      "discard",
    ]);
    expect(CLAUDE_LIMIT_MS).toBe(20 * 60_000);
    expect(PREVIEW_LIMIT_MS).toBe(10 * 60_000);
  });

  it("reports the summary, branch, pull request, preview and four pictures of the changed page", async () => {
    const f = fake();
    await runOnce(f.deps);
    expect(f.shots).toEqual([
      `phone ${PREVIEW}/lighting`,
      `desktop ${PREVIEW}/lighting`,
      "phone https://alderhouse.example/lighting",
      "desktop https://alderhouse.example/lighting",
    ]);
    expect(f.finished).toEqual([
      {
        status: "done",
        summary: answer.summary,
        branch: BRANCH,
        prUrl: PR,
        previewUrl: PREVIEW,
        pictures: [
          { label: "after", width: "phone", storagePath: "coach/u/1.png" },
          { label: "after", width: "desktop", storagePath: "coach/u/2.png" },
          { label: "before", width: "phone", storagePath: "coach/u/3.png" },
          { label: "before", width: "desktop", storagePath: "coach/u/4.png" },
        ],
      },
    ]);
  });

  it("takes only the after pictures when the project has no live site", async () => {
    const f = fake({ brief: brief({ siteUrl: null }) });
    await runOnce(f.deps);
    expect(f.finished[0].pictures?.map((p) => p.label)).toEqual(["after", "after"]);
  });

  it("pictures the home page when Claude named no page", async () => {
    const f = fake({ claude: { ok: true, stdout: stdout({ summary: "Done.", paths: [] }) } });
    await runOnce(f.deps);
    expect(f.shots[0]).toBe(`phone ${PREVIEW}/`);
  });

  it("opens a pull request with the summary and without the client's words", async () => {
    const f = fake();
    await runOnce(f.deps);
    const [pr] = f.published;
    expect(pr.branch).toBe(BRANCH);
    expect(pr.title).toBe("Move the sconces up on page 2");
    expect(pr.body).toContain(answer.summary);
    expect(pr.body).toContain("Made by the Cliphy runner for a request the owner confirmed.");
    for (const m of brief().messages) expect(pr.body).not.toContain(m.text);
    expect(pr.body).not.toContain("Maren");
  });

  it("fails with Claude's explanation when nothing changed, and publishes nothing", async () => {
    const f = fake({
      changed: false,
      claude: { ok: true, stdout: stdout({ summary: "I could not find a page 2.", paths: [] }) },
    });
    expect(await runOnce(f.deps)).toBe("failed");
    expect(f.finished).toEqual([{ status: "failed", error: "I could not find a page 2." }]);
    expect(f.calls).not.toContain("publish");
  });

  it("fails when Claude runs out of time, and publishes nothing it half did", async () => {
    const f = fake({ claude: { ok: false, reason: "timeout", detail: "" } });
    expect(await runOnce(f.deps)).toBe("failed");
    expect(f.finished).toEqual([{ status: "failed", error: "It took longer than 20 minutes." }]);
    expect(f.calls).not.toContain("publish");
    expect(f.calls).not.toContain("collect");
  });

  it("fails when Claude could not run", async () => {
    const f = fake({ claude: { ok: false, reason: "error", detail: "not logged in" } });
    expect(await runOnce(f.deps)).toBe("failed");
    expect(f.finished).toEqual([{ status: "failed", error: "Claude Code could not do the work." }]);
    expect(f.calls).not.toContain("publish");
  });

  it("fails when Claude did not say what it changed, and publishes nothing", async () => {
    const f = fake({ claude: { ok: true, stdout: "I changed some things" } });
    expect(await runOnce(f.deps)).toBe("failed");
    expect(f.finished).toEqual([
      { status: "failed", error: "Claude did not say what it changed." },
    ]);
    expect(f.calls).not.toContain("publish");
  });

  it("stops without publishing when the run is stopped while Claude works", async () => {
    const f = fake({ cancelledFrom: 1 });
    expect(await runOnce(f.deps)).toBe("cancelled");
    expect(f.calls).not.toContain("publish");
    expect(f.calls).not.toContain("finish");
    expect(f.calls.at(-1)).toBe("discard");
  });

  it("stops without publishing when the run is stopped just before the pull request", async () => {
    const f = fake({ cancelledFrom: 2 });
    expect(await runOnce(f.deps)).toBe("cancelled");
    expect(f.calls).not.toContain("publish");
    expect(f.calls).not.toContain("finish");
  });

  it("finishes with the pull request alone when no preview appears", async () => {
    const f = fake({ preview: null });
    expect(await runOnce(f.deps)).toBe("done");
    expect(f.finished).toEqual([
      { status: "done", summary: answer.summary, branch: BRANCH, prUrl: PR, pictures: [] },
    ]);
    expect(f.shots).toEqual([]);
  });

  it("still finishes when the pictures cannot be taken or stored", async () => {
    for (const what of ["shoot", "upload"] as const) {
      const f = fake({ fail: { [what]: true } });
      expect(await runOnce(f.deps)).toBe("done");
      expect(f.finished[0]).toMatchObject({ status: "done", prUrl: PR, pictures: [] });
    }
  });

  it("fails in plain words when the pull request cannot be opened", async () => {
    const f = fake({ fail: { publish: true } });
    expect(await runOnce(f.deps)).toBe("failed");
    expect(f.finished).toEqual([{ status: "failed", error: "Could not open the pull request." }]);
  });

  it("fails in plain words when the repo cannot be prepared", async () => {
    const f = fake({ fail: { prepare: true } });
    expect(await runOnce(f.deps)).toBe("failed");
    expect(f.finished).toEqual([{ status: "failed", error: "Could not get the website's code." }]);
  });

  it("always clears the work away afterwards, whatever happened", async () => {
    for (const w of [
      {},
      { changed: false },
      { fail: { prepare: true } },
      { fail: { collect: true } },
      { fail: { publish: true } },
      { cancelledFrom: 1 },
      { preview: null },
    ] as World[]) {
      const f = fake(w);
      await runOnce(f.deps);
      expect(f.calls.at(-1), JSON.stringify(w)).toBe("discard");
    }
  });
});
