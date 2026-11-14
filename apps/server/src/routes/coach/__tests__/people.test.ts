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

const { coachRoutes } = await import("../index.js");
const app = () => new Hono().route("/api/coach", coachRoutes);
const post = (path: string, body: unknown) => app().request(path, json("POST", body));

const personRow = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Maren",
  role: "client",
  handles: [],
  capture_thread: false,
  history_window: "new",
  history_days: null,
  ...over,
});

describe("coach people", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("People");
    db = makeDb();
  });

  it("rejects a role outside client/collaborator/both", async () => {
    const res = await post("/api/coach/people", { name: "Maren", role: "vendor" });
    expect(res.status).toBe(400);
    expect(db.writtenTables()).toEqual([]);
  });

  it("rejects an empty name", async () => {
    expect((await post("/api/coach/people", { name: "  ", role: "client" })).status).toBe(400);
  });

  it("requires historyDays when the window is 'window'", async () => {
    const res = await post("/api/coach/people", {
      name: "Maren",
      role: "client",
      historyWindow: "window",
    });
    expect(res.status).toBe(400);
  });

  it("creates a person who is both client and collaborator", async () => {
    db = makeDb((op) =>
      op.action === "insert" ? { data: personRow({ role: "both" }) } : undefined,
    );
    const res = await post("/api/coach/people", { name: " Maren ", role: "both" });
    expect(res.status).toBe(201);
    expect((await res.json()).person.role).toBe("both");
    expect(db.written("coach_people")[0]).toMatchObject({
      user_id: "test-user-id",
      name: "Maren",
      role: "both",
    });
  });

  it("stores a per-person history window", async () => {
    db = makeDb((op) => (op.action === "insert" ? { data: personRow() } : undefined));
    await post("/api/coach/people", {
      name: "Maren",
      role: "client",
      historyWindow: "window",
      historyDays: 90,
    });
    expect(db.written("coach_people")[0]).toMatchObject({
      history_window: "window",
      history_days: 90,
    });
  });

  // Messages stores numbers as +15551234567; a number typed any other way would match nothing.
  it("stores phone numbers the way Messages does, and emails in lower case", async () => {
    db = makeDb((op) => (op.action === "insert" ? { data: personRow() } : undefined));
    await post("/api/coach/people", {
      name: "Maren",
      role: "client",
      handles: [
        "(555) 123-4567",
        "1-555-987-6543",
        "+44 20 7946 0958",
        " Maren@Example.COM ",
        "  ",
      ],
    });
    expect((db.written("coach_people")[0] as { handles: string[] }).handles).toEqual([
      "+15551234567",
      "+15559876543",
      "+442079460958",
      "maren@example.com",
    ]);
  });

  it("lists the caller's people", async () => {
    db = makeDb(() => ({ data: [personRow()] }));
    const res = await app().request("/api/coach/people");
    expect((await res.json()).people).toHaveLength(1);
    expect(db.ops[0].filters).toContainEqual(["eq", "user_id", "test-user-id"]);
  });

  it("404s a patch to a person that is not the caller's", async () => {
    const res = await app().request("/api/coach/people/nope", json("PATCH", { name: "X" }));
    expect(res.status).toBe(404);
  });
});
