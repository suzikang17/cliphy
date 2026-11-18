import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, passAuth, passCoach, json, type FakeDb, type Op } from "./helpers.js";

// POST /people/:id/digest: a person's recent texts read into the distinct
// requests in them, each quote returned with its message's time and pictures.

let db: FakeDb;
const findRequests = vi.fn();
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../../lib/storage.js", () => ({
  signImageUrl: vi.fn(async (p: string) => `https://signed/${p}`),
}));
vi.mock("../../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
vi.mock("../../../services/coach/digest.js", async (orig) => ({
  ...(await orig<typeof import("../../../services/coach/digest.js")>()),
  findRequests: (...a: unknown[]) => findRequests(...a),
}));
vi.mock("../../../middleware/auth.js", () => passAuth);
vi.mock("../../../middleware/require-coach.js", () => passCoach);

const { coachRoutes } = await import("../index.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const post = (path: string, body: unknown = {}) =>
  app().request(`/api/coach${path}`, json("POST", body));

const message = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  person_id: "p1",
  channel: "imessage",
  direction: "in",
  text: `text ${id}`,
  attachments: [],
  sent_at: "2026-11-17T10:00:00Z",
  ...over,
});

function digestDb(opts: { person?: boolean; messages?: unknown[] } = {}) {
  return makeDb((op: Op) => {
    if (op.table === "coach_people") {
      return { data: opts.person === false ? null : { id: "p1", name: "Maren" } };
    }
    if (op.table === "coach_messages") return { data: opts.messages ?? [] };
    if (op.table === "coach_tasks") {
      return {
        data: [
          {
            id: "t1",
            state: "open",
            title: "Swap front image",
            kit: {},
            checklist: [],
            created_at: "x",
          },
          { id: "t2", state: "done", title: "Old", kit: {}, checklist: [], created_at: "x" },
        ],
      };
    }
    if (op.table === "coach_projects") return { data: [{ id: "pr1", name: "Alder House" }] };
    if (op.table === "coach_settings") return { data: { timezone: "America/New_York" } };
    return undefined;
  });
}

beforeEach(async () => {
  await layer("unit");
  await epic("Coach");
  await feature("Digest");
  findRequests.mockReset();
});

describe("POST /people/:id/digest", () => {
  it("reads the last days of the thread, oldest first, and returns each quote with its message", async () => {
    db = digestDb({
      messages: [
        message("m2", {
          sent_at: "2026-11-17T12:00:00Z",
          attachments: [{ storagePath: "coach/test-user-id/a.png", mediaType: "image/png", at: 3 }],
        }),
        message("m1", { direction: "out" }),
      ],
    });
    findRequests.mockResolvedValue([
      {
        name: "Front page",
        items: [
          {
            title: "Move the photo down",
            detail: "d",
            quotes: [{ messageId: "m2", text: "text m2" }],
            taskId: "t1",
            projectId: "pr1",
            dueDate: null,
            answered: false,
          },
        ],
      },
    ]);
    const res = await post("/people/p1/digest", { days: 7 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      days: number;
      messageCount: number;
      groups: { items: { quotes: Record<string, unknown>[] }[] }[];
    };
    expect(body.days).toBe(7);
    expect(body.messageCount).toBe(2);
    expect(body.groups[0].items[0].quotes[0]).toEqual({
      messageId: "m2",
      text: "text m2",
      sentAt: "2026-11-17T12:00:00Z",
      attachments: [
        {
          storagePath: "coach/test-user-id/a.png",
          mediaType: "image/png",
          at: 3,
          url: "https://signed/coach/test-user-id/a.png",
        },
      ],
    });

    const ctx = findRequests.mock.calls[0][0] as {
      personName: string;
      messages: { id: string; direction: string; pictures: number }[];
      openTasks: { id: string }[];
      projects: { id: string }[];
    };
    expect(ctx.personName).toBe("Maren");
    // Oldest first, as a thread reads.
    expect(ctx.messages.map((m) => [m.id, m.direction, m.pictures])).toEqual([
      ["m1", "out", 0],
      ["m2", "in", 1],
    ]);
    // Only work still open is offered as "already covered".
    expect(ctx.openTasks.map((t) => t.id)).toEqual(["t1"]);
    expect(ctx.projects.map((p) => p.id)).toEqual(["pr1"]);

    const read = db.ops.find((o) => o.table === "coach_messages")!;
    const since = read.filters.find(([m, c]) => m === "gte" && c === "sent_at")?.[2] as string;
    const days = (Date.now() - Date.parse(since)) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("asks the model nothing when there are no messages in the range", async () => {
    db = digestDb({ messages: [] });
    const res = await post("/people/p1/digest", { days: 7 });
    expect(await res.json()).toMatchObject({ groups: [], messageCount: 0 });
    expect(findRequests).not.toHaveBeenCalled();
  });

  it("passes the model's failure on in its own words", async () => {
    db = digestDb({ messages: [message("m1")] });
    findRequests.mockRejectedValue(new Error("The model returned no requests"));
    const res = await post("/people/p1/digest", { days: 7 });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "The model returned no requests" });
  });

  it("refuses a range that is not 1 to 365 days, and someone else's person", async () => {
    db = digestDb({});
    expect((await post("/people/p1/digest", { days: 0 })).status).toBe(400);
    expect((await post("/people/p1/digest", { days: 1000 })).status).toBe(400);
    expect((await post("/people/p1/digest", { days: "week" })).status).toBe(400);
    db = digestDb({ person: false });
    expect((await post("/people/p1/digest", { days: 7 })).status).toBe(404);
  });
});
