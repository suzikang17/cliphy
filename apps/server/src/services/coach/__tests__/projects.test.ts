import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { makeDb, type FakeDb } from "../../../routes/coach/__tests__/helpers.js";

let db: FakeDb;
vi.mock("../../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => db.from(t) },
}));

const { projectTag, projectNameFromTag, seedProjectsFromTags } = await import("../projects.js");

describe("coach projects service", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Projects");
  });

  it("slugs a project name into a project: tag", () => {
    expect(projectTag("  Alder House!  ")).toBe("project:alder-house");
  });

  it("gives a bare prefix for a name with nothing sluggable", () => {
    expect(projectTag("!!!")).toBe("project:");
  });

  it("turns a tag back into a readable name", () => {
    expect(projectNameFromTag("project:alder-house")).toBe("Alder house");
  });

  it("seeds one project per distinct project: tag from hints and clips", async () => {
    db = makeDb((op) => {
      if (op.table === "tag_hints") {
        return { data: [{ tag: "project:alder-house" }, { tag: "client:acme" }] };
      }
      if (op.table === "clips") {
        return { data: [{ tags: ["project:studio-prints", "project:alder-house", "idea"] }] };
      }
      if (op.table === "coach_projects") return { data: [{ id: "a" }, { id: "b" }] };
      return undefined;
    });
    const created = await seedProjectsFromTags("u1");
    expect(created).toBe(2);
    const rows = db.written("coach_projects", "upsert")[0] as { tag: string; name: string }[];
    expect(rows.map((r) => r.tag).sort()).toEqual(["project:alder-house", "project:studio-prints"]);
    expect(rows.find((r) => r.tag === "project:studio-prints")?.name).toBe("Studio prints");
  });

  it("creates nothing when there are no project: tags", async () => {
    db = makeDb(() => ({ data: [] }));
    expect(await seedProjectsFromTags("u1")).toBe(0);
    expect(db.writtenTables()).toEqual([]);
  });
});
