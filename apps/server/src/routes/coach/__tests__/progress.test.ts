import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, passAuth, passCoach, json, type FakeDb, type Op } from "./helpers.js";

let db: FakeDb;
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../../lib/storage.js", () => ({
  signImageUrl: vi.fn(async (p: string) => `https://signed/${p}`),
}));
vi.mock("../../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
const createImageClip = vi.fn();
vi.mock("../../../services/imageClip.js", () => ({
  createImageClip: (...a: unknown[]) => createImageClip(...a),
}));
vi.mock("../../../middleware/auth.js", () => passAuth);
vi.mock("../../../middleware/require-coach.js", () => passCoach);

const { coachRoutes } = await import("../index.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const post = (path: string, body: unknown = {}) => app().request(path, json("POST", body));

const projects = [
  { id: "pr1", name: "Alder House", tag: "project:alder-house", active: true },
  { id: "pr2", name: "Portfolio", tag: "project:portfolio", active: true },
];
function world(w: { focus?: Record<string, unknown>; projects?: typeof projects } = {}) {
  return makeDb((op: Op) => {
    if (op.table === "coach_projects") return { data: w.projects ?? projects };
    if (op.table === "coach_settings")
      return { data: { timezone: "America/Los_Angeles", ...(w.focus ?? {}) } };
    if (op.table === "coach_progress" && op.action === "insert") {
      return { data: { id: "e1", created_at: "2026-11-16T20:00:00Z", ...(op.payload as object) } };
    }
    if (op.table === "coach_progress") {
      return {
        data: [
          {
            id: "e1",
            project_id: "pr1",
            storage_path: "coach/test-user-id/p.jpg",
            created_at: "2026-11-16T20:00:00Z",
          },
        ],
      };
    }
    if (op.table === "coach_chat_messages") return { data: [{ id: "m-new" }] };
    if (op.table === "coach_requests") return { data: [] };
    return { data: [] };
  });
}
const posted = () => db.written("coach_chat_messages") as Record<string, unknown>[];
const body = { storagePath: "coach/test-user-id/p.jpg" };

describe("coach progress photos", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Progress");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T20:00:00Z"));
    createImageClip.mockReset();
    createImageClip.mockResolvedValue({ id: "c1" });
    db = world();
  });
  afterEach(() => vi.useRealTimers());

  it("files a photo quietly under what she just said she is working on", async () => {
    db = world({ focus: { focus_project_id: "pr1", focus_set_at: "2026-11-16T19:00:00Z" } });
    const res = await post("/api/coach/progress", body);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      tier: "sure",
      project: { id: "pr1", name: "Alder House" },
      entry: { id: "e1", projectId: "pr1" },
    });
    expect(db.written("coach_progress", "insert")[0]).toMatchObject({
      user_id: "test-user-id",
      project_id: "pr1",
      storage_path: "coach/test-user-id/p.jpg",
      clip_id: "c1",
    });
    // The photo is also a Library clip, tagged with its project.
    expect(createImageClip).toHaveBeenCalledWith("test-user-id", "coach/test-user-id/p.jpg", [
      "project:alder-house",
    ]);
    // Sure means quiet: nothing is said in chat.
    expect(posted()).toEqual([]);
  });

  it("files and says where when it is only fairly sure", async () => {
    db = world({ focus: { focus_project_id: "pr1", focus_set_at: "2026-11-16T05:00:00Z" } });
    const res = await post("/api/coach/progress", body);
    expect((await res.json()).tier).toBe("fairly");
    expect(posted()[0]).toMatchObject({
      kind: "progress",
      ref_id: "e1",
      text: "Filed under Alder House.",
    });
  });

  // Review Focus 4: no focus, several projects.
  it("does not guess between projects: it saves the photo unfiled and asks", async () => {
    const res = await post("/api/coach/progress", body);
    const out = await res.json();
    expect(out).toMatchObject({ tier: "unsure", project: null });
    expect(db.written("coach_progress", "insert")[0]).toMatchObject({ project_id: null });
    expect(createImageClip).toHaveBeenCalledWith("test-user-id", "coach/test-user-id/p.jpg", []);
    expect(posted()[0]).toMatchObject({
      kind: "progress",
      text: "Which project is this photo for?",
    });
  });

  it("uses the project she names, without asking", async () => {
    const res = await post("/api/coach/progress", { ...body, projectId: "pr2" });
    expect(await res.json()).toMatchObject({ tier: "sure", project: { id: "pr2" } });
    expect(posted()).toEqual([]);
  });

  it("rejects a project that is not hers and a photo outside her folder", async () => {
    expect(
      (await post("/api/coach/progress", { ...body, projectId: "someone-elses" })).status,
    ).toBe(400);
    expect(
      (await post("/api/coach/progress", { storagePath: "coach/other-user/p.jpg" })).status,
    ).toBe(400);
    expect(
      (await post("/api/coach/progress", { storagePath: "coach/test-user-id/../x/p.jpg" })).status,
    ).toBe(400);
    expect(db.writtenTables()).toEqual([]);
  });

  it("still saves the photo when the Library clip cannot be made", async () => {
    createImageClip.mockRejectedValue(new Error("Failed to save clip"));
    db = world({ focus: { focus_project_id: "pr1", focus_set_at: "2026-11-16T19:00:00Z" } });
    const res = await post("/api/coach/progress", body);
    expect(res.status).toBe(201);
    expect(db.written("coach_progress", "insert")[0]).toMatchObject({ clip_id: null });
  });

  it("moves a photo to the project she picks afterwards", async () => {
    const inner = world();
    db = makeDb((op: Op) => {
      if (op.table === "coach_projects" && op.single) {
        return { data: { id: "pr2", name: "Portfolio", tag: "project:portfolio" } };
      }
      if (op.table === "coach_progress" && op.action === "select") {
        return { data: { id: "e1", project_id: "pr1", clip_id: null } };
      }
      return inner.respond(op);
    });
    const res = await post("/api/coach/progress/e1/project", { projectId: "pr2" });
    expect(await res.json()).toEqual({ moved: true, say: "Moved to Portfolio." });
    const upd = db.ops.find((o) => o.table === "coach_progress" && o.action === "update")!;
    expect(upd.payload).toEqual({ project_id: "pr2" });
  });

  // Review Focus 5: the Library clip's project tag follows the photo.
  it("moves the Library clip's project tag with the photo, keeping its other tags", async () => {
    const inner = world();
    db = makeDb((op: Op) => {
      if (op.table === "coach_projects") {
        return op.single
          ? { data: { id: "pr2", name: "Portfolio", tag: "project:portfolio" } }
          : { data: [{ tag: "project:alder-house" }, { tag: "project:portfolio" }] };
      }
      if (op.table === "coach_progress" && op.action === "select") {
        return { data: { id: "e1", project_id: "pr1", clip_id: "c1" } };
      }
      if (op.table === "clips" && op.action === "select") {
        return { data: { id: "c1", tags: ["project:alder-house", "typography"] } };
      }
      return inner.respond(op);
    });
    await post("/api/coach/progress/e1/project", { projectId: "pr2" });
    const clip = db.ops.find((o) => o.table === "clips" && o.action === "update")!;
    expect(clip.payload).toEqual({ tags: ["typography", "project:portfolio"] });
    expect(clip.filters).toContainEqual(["eq", "user_id", "test-user-id"]);
  });

  it("still reports the photo as saved when the chat message about it cannot be posted", async () => {
    const inner = world();
    db = makeDb((op: Op) =>
      op.table === "coach_chat_messages"
        ? { data: null, error: { message: "boom" } }
        : inner.respond(op),
    );
    const res = await post("/api/coach/progress", body);
    expect(res.status).toBe(201);
    expect((await res.json()).tier).toBe("unsure");
  });

  it("says nothing moved when the photo or project is not hers", async () => {
    db = makeDb(() => ({ data: null }));
    const res = await post("/api/coach/progress/nope/project", { projectId: "pr2" });
    expect(await res.json()).toEqual({ moved: false, say: null });
  });

  it("shows a project's progress photos alongside its history", async () => {
    const res = await app().request("/api/coach/projects/pr1/history");
    const out = await res.json();
    expect(out.progress).toEqual([
      {
        id: "e1",
        projectId: "pr1",
        url: "https://signed/coach/test-user-id/p.jpg",
        createdAt: "2026-11-16T20:00:00Z",
      },
    ]);
  });
});
