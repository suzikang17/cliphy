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
