import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, passAuth, passCoach, json, type FakeDb } from "./helpers.js";

let db: FakeDb;
vi.mock("../../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => db.from(t) },
}));
vi.mock("../../../middleware/auth.js", () => passAuth);
vi.mock("../../../middleware/require-coach.js", () => passCoach);
const seedMock = vi.fn();
vi.mock("../../../services/coach/projects.js", async (orig) => ({
  ...(await orig<typeof import("../../../services/coach/projects.js")>()),
  seedProjectsFromTags: (...a: unknown[]) => seedMock(...a),
}));

const { coachRoutes } = await import("../index.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const post = (path: string, body: unknown) => app().request(path, json("POST", body));

const projectRow = { id: "pr1", name: "Alder House", tag: "project:alder-house", active: true };

describe("coach projects", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Projects");
    db = makeDb();
    seedMock.mockReset();
  });

  it("seed reports how many projects were created from project: tags", async () => {
    seedMock.mockResolvedValue(2);
    const res = await post("/api/coach/projects/seed", {});
    expect(await res.json()).toEqual({ created: 2 });
    expect(seedMock).toHaveBeenCalledWith("test-user-id");
  });

  it("creates a project with its tag and links its people", async () => {
    db = makeDb((op) => {
      if (op.table === "coach_projects" && op.action === "insert") return { data: projectRow };
      if (op.table === "coach_people") return { data: [{ id: "p1" }] };
      return undefined;
    });
    const res = await post("/api/coach/projects", { name: "Alder House", personIds: ["p1", "x"] });
    expect(res.status).toBe(201);
    expect((await res.json()).project).toMatchObject({
      tag: "project:alder-house",
      personIds: ["p1"],
    });
    expect(db.written("coach_projects")[0]).toMatchObject({ tag: "project:alder-house" });
    expect(db.written("coach_project_people")[0]).toEqual([{ project_id: "pr1", person_id: "p1" }]);
  });

  it("409s when a project with the same tag exists", async () => {
    db = makeDb((op) =>
      op.action === "insert" ? { data: null, error: { code: "23505" } } : undefined,
    );
    expect((await post("/api/coach/projects", { name: "Alder House" })).status).toBe(409);
  });

  it("rejects a name with nothing to make a tag from", async () => {
    expect((await post("/api/coach/projects", { name: "!!!" })).status).toBe(400);
  });

  it("gives a project's website repo and live site, or null for each", async () => {
    db = makeDb((op) =>
      op.table === "coach_projects"
        ? {
            data: [
              {
                ...projectRow,
                repo: "example/alder-house",
                site_url: "https://alderhouse.example",
              },
              { ...projectRow, id: "pr2" },
            ],
          }
        : undefined,
    );
    const { projects } = await (await app().request("/api/coach/projects")).json();
    expect(projects[0]).toMatchObject({
      repo: "example/alder-house",
      siteUrl: "https://alderhouse.example",
    });
    expect(projects[1]).toMatchObject({ repo: null, siteUrl: null });
  });

  describe("the website repo and live site", () => {
    const patch = (body: unknown) => app().request("/api/coach/projects/pr1", json("PATCH", body));
    const saved = () =>
      makeDb((op) => (op.table === "coach_projects" ? { data: projectRow } : undefined));

    it("stores a repo written as owner/name", async () => {
      db = saved();
      expect((await patch({ repo: "example/alder-house" })).status).toBe(200);
      expect(db.written("coach_projects")[0]).toEqual({ repo: "example/alder-house" });
    });

    it("refuses anything else as a repo", async () => {
      const res = await patch({ repo: "not a repo" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "repo must look like owner/name" });
    });

    it("refuses a live site that is not an https address", async () => {
      const res = await patch({ siteUrl: "alderhouse.example" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "site address must start with https://" });
    });

    it("clears either when given nothing", async () => {
      db = saved();
      await patch({ repo: "", siteUrl: " " });
      expect(db.written("coach_projects")[0]).toEqual({ repo: null, site_url: null });
    });

    it("stores a live site", async () => {
      db = saved();
      await patch({ siteUrl: "https://alderhouse.example/" });
      expect(db.written("coach_projects")[0]).toEqual({ site_url: "https://alderhouse.example" });
    });
  });

  it("lists projects with the people on each", async () => {
    db = makeDb((op) => {
      if (op.table === "coach_projects") return { data: [projectRow] };
      if (op.table === "coach_project_people") {
        return { data: [{ project_id: "pr1", person_id: "p1" }] };
      }
      return undefined;
    });
    const res = await app().request("/api/coach/projects");
    expect((await res.json()).projects[0].personIds).toEqual(["p1"]);
  });
});
