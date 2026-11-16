import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import type { CoachTask, Person, Project } from "@cliphy/shared";
import { buildUpNext } from "../upNext.js";

const task = (over: Partial<CoachTask>): CoachTask => ({
  id: "t",
  requestId: null,
  projectId: null,
  kind: "do",
  state: "open",
  title: "Task",
  kit: {},
  withPersonId: null,
  afterTaskId: null,
  blocked: false,
  dueDate: null,
  dueTime: null,
  place: null,
  checklist: [],
  replyBundleId: null,
  createdAt: "2026-11-01T00:00:00Z",
  doneAt: null,
  ...over,
});
const people: Person[] = [
  {
    id: "p1",
    name: "Maren",
    role: "client",
    handles: [],
    captureThread: true,
    historyWindow: "new",
    historyDays: null,
  },
];
const projects: Project[] = [
  {
    id: "pr1",
    name: "Alder House",
    tag: "project:alder-house",
    active: true,
    stateLine: "Copy refresh",
    personIds: ["p1"],
    repo: null,
    siteUrl: null,
  },
  {
    id: "pr2",
    name: "Studio prints",
    tag: "project:studio-prints",
    active: true,
    stateLine: "",
    personIds: [],
    repo: null,
    siteUrl: null,
  },
  {
    id: "pr3",
    name: "Old site",
    tag: "project:old-site",
    active: false,
    stateLine: "",
    personIds: [],
    repo: null,
    siteUrl: null,
  },
];
const today = "2026-11-14"; // a Saturday

describe("buildUpNext", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Up next");
  });

  it("sorts dated tasks into overdue, this week by day, and later", () => {
    const up = buildUpNext(
      [
        task({ id: "late", title: "Late", dueDate: "2026-11-12" }),
        task({ id: "sun", title: "Sunday thing", dueDate: "2026-11-15", dueTime: "09:00" }),
        task({
          id: "wed",
          title: "Homepage photo swap",
          dueDate: "2026-11-18",
          requestId: "r1",
          withPersonId: "p1",
        }),
        task({ id: "wed2", title: "Second Wednesday thing", dueDate: "2026-11-18" }),
        task({ id: "dec", title: "December invoice", dueDate: "2026-12-01" }),
      ],
      people,
      projects,
      today,
    );
    expect(up.overdue.map((t) => t.id)).toEqual(["late"]);
    expect(up.thisWeek.map((d) => [d.date, d.tasks.map((t) => t.id)])).toEqual([
      ["2026-11-15", ["sun"]],
      ["2026-11-18", ["wed", "wed2"]],
    ]);
    expect(up.later.map((t) => t.id)).toEqual(["dec"]);
  });

  it("counts today and the next six days as this week", () => {
    const up = buildUpNext(
      [
        task({ id: "a", dueDate: "2026-11-14" }),
        task({ id: "b", dueDate: "2026-11-20" }),
        task({ id: "c", dueDate: "2026-11-21" }),
      ],
      people,
      projects,
      today,
    );
    expect(up.thisWeek.flatMap((d) => d.tasks.map((t) => t.id))).toEqual(["a", "b"]);
    expect(up.later.map((t) => t.id)).toEqual(["c"]);
  });

  it("gives each row one short detail: who asked and for when, or the time", () => {
    const up = buildUpNext(
      [
        // Work from Maren's request: a `do` task is not "with" anyone.
        task({ id: "wed", dueDate: "2026-11-18", requestId: "r1", withPersonId: null }),
        task({ id: "sun", dueDate: "2026-11-15", dueTime: "09:00" }),
        task({ id: "own", dueDate: "2026-11-16" }),
      ],
      people,
      projects,
      today,
      new Map([["r1", "p1"]]),
    );
    const detail = (id: string) =>
      up.thisWeek.flatMap((d) => d.tasks).find((t) => t.id === id)?.detail;
    expect(detail("wed")).toBe("Maren asked for Wednesday");
    expect(detail("sun")).toBe("You set 09:00");
    expect(detail("own")).toBe("You set this");
  });

  it("summarises the week for the strip: how many, and what is next", () => {
    const up = buildUpNext(
      [
        task({ id: "late", title: "Late", dueDate: "2026-11-12" }),
        task({ id: "sun", title: "Alder House copy", dueDate: "2026-11-15", dueTime: "09:00" }),
      ],
      people,
      projects,
      today,
    );
    expect(up.strip).toEqual({ thisWeek: 2, next: "Alder House copy · Sun 09:00" });
  });

  it("has an empty strip when nothing is dated", () => {
    expect(buildUpNext([task({ id: "a" })], people, projects, today).strip).toEqual({
      thisWeek: 0,
      next: null,
    });
  });

  it("lists tasks waiting on someone separately, saying who", () => {
    const up = buildUpNext(
      [
        task({
          id: "ask",
          kind: "ask",
          state: "waiting",
          title: "Words or type?",
          withPersonId: "p1",
          dueDate: "2026-11-18",
        }),
      ],
      people,
      projects,
      today,
    );
    expect(up.waiting.map((t) => [t.id, t.detail])).toEqual([["ask", "Waiting on Maren"]]);
    expect(up.thisWeek).toEqual([]);
  });

  it("groups undated errands by place and keeps them off the back burner", () => {
    const up = buildUpNext(
      [
        task({ id: "g1", kind: "get", title: "Mat board", place: "Art store" }),
        task({ id: "g2", kind: "get", title: "Hanging wire", place: "art store " }),
        task({ id: "g3", kind: "get", title: "Stamps" }),
      ],
      people,
      projects,
      today,
    );
    expect(up.errands.map((e) => [e.place, e.tasks.map((t) => t.id)])).toEqual([
      ["Art store", ["g1", "g2"]],
      ["Anywhere", ["g3"]],
    ]);
    expect(up.backBurner.count).toBe(0);
  });

  it("folds undated tasks into the back burner with a count and the first few titles", () => {
    const tasks = [
      "Frame the print",
      "Update portfolio",
      "Sort fonts",
      "Archive drive",
      "Renew domain",
    ].map((title, i) => task({ id: `b${i}`, title, createdAt: `2026-11-0${i + 1}T00:00:00Z` }));
    const up = buildUpNext(tasks, people, projects, today);
    expect(up.backBurner).toEqual({
      count: 5,
      titles: ["Frame the print", "Update portfolio", "Sort fonts"],
    });
  });

  it("leaves out finished and dropped tasks everywhere", () => {
    const up = buildUpNext(
      [
        task({ id: "d", state: "done", dueDate: "2026-11-15" }),
        task({ id: "x", state: "dropped" }),
      ],
      people,
      projects,
      today,
    );
    expect(up.thisWeek).toEqual([]);
    expect(up.backBurner.count).toBe(0);
  });

  it("shows each active project with its state, open count and next step", () => {
    const up = buildUpNext(
      [
        task({ id: "a", title: "Replace page 2 copy", projectId: "pr1", dueDate: "2026-11-15" }),
        task({
          id: "b",
          title: "Tell Maren it's live",
          projectId: "pr1",
          blocked: true,
          afterTaskId: "a",
        }),
        task({ id: "c", title: "Old thing", projectId: "pr3" }),
      ],
      people,
      projects,
      today,
    );
    expect(up.byProject).toEqual([
      {
        projectId: "pr1",
        name: "Alder House",
        state: "Copy refresh",
        next: "Replace page 2 copy",
        open: 2,
      },
      { projectId: "pr2", name: "Studio prints", state: "", next: null, open: 0 },
    ]);
  });
});
