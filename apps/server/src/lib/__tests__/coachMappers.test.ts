import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { toPerson, toProject, toMessage, toRequest, toTask } from "../coachMappers.js";

describe("coach mappers", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Mappers");
  });

  it("maps a task row and carries the computed blocked flag", () => {
    const t = toTask(
      {
        id: "t1",
        kind: "do",
        state: "open",
        title: "Replace page 2 copy",
        kit: { doneWhen: "New copy is live" },
        after_task_id: "t0",
        checklist: [],
        due_date: "2026-11-18",
        due_time: null,
        created_at: "2026-11-14T09:44:00Z",
      },
      true,
    );
    expect(t).toMatchObject({
      kind: "do",
      afterTaskId: "t0",
      blocked: true,
      dueDate: "2026-11-18",
      dueTime: null,
      kit: { doneWhen: "New copy is live" },
    });
  });

  it("defaults a request's proposedTasks and openQuestion", () => {
    const r = toRequest({
      id: "r1",
      bundle_id: "b1",
      person_id: "p1",
      understood: "x",
      status: "new",
    });
    expect(r.proposedTasks).toEqual([]);
    expect(r.openQuestion).toBeNull();
    expect(r.historical).toBe(false);
  });

  it("maps a person with role and history window", () => {
    const p = toPerson({
      id: "p1",
      name: "Maren",
      role: "both",
      handles: ["+15550100"],
      capture_thread: true,
      history_window: "window",
      history_days: 90,
    });
    expect(p).toEqual({
      id: "p1",
      name: "Maren",
      role: "both",
      handles: ["+15550100"],
      captureThread: true,
      historyWindow: "window",
      historyDays: 90,
    });
  });

  it("maps a project with its people", () => {
    const p = toProject(
      { id: "pr1", name: "Alder House", tag: "project:alder-house", active: true },
      ["p1"],
    );
    expect(p).toMatchObject({ tag: "project:alder-house", stateLine: "", personIds: ["p1"] });
  });

  it("maps a message and defaults attachments to an empty list", () => {
    const m = toMessage({
      id: "m1",
      person_id: "p1",
      channel: "imessage",
      direction: "in",
      sent_at: "2026-11-14T09:42:00Z",
    });
    expect(m).toMatchObject({ text: "", attachments: [], sentAt: "2026-11-14T09:42:00Z" });
  });
});
