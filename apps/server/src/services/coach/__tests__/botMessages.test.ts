import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import {
  requestArrived,
  replyArrived,
  reminderDue,
  taskUnblocked,
  weeklyReview,
  pushNotWorking,
  ruleLearned,
  checkIn,
  progressFiled,
  progressAsk,
  didAction,
  startOnSite,
  runStarted,
  runFinished,
  runnerQuiet,
} from "../botMessages.js";
import type { CoachRun } from "@cliphy/shared";

const request = {
  id: "r1",
  understood: "Maren asked to replace the page 2 text on Alder House.",
  openQuestion: {
    text: 'Does "writing" mean only the words, or the typeface too?',
    options: ["Only words", "Type too", "Ask Maren"],
  },
};
const images = [
  { storagePath: "coach/u/a.png", mediaType: "image/png" },
  { storagePath: "coach/u/b.png", mediaType: "image/png" },
  { storagePath: "coach/u/c.png", mediaType: "image/png" },
];

describe("bot messages", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Chat");
  });

  it("reports a request with its one question, the options as buttons, and a link to it", () => {
    const m = requestArrived(request, images);
    expect(m.text).toBe(
      'Maren asked to replace the page 2 text on Alder House.\n\nDoes "writing" mean only the words, or the typeface too?',
    );
    expect(m.buttons.map((b) => b.label)).toEqual(["Only words", "Type too", "Ask Maren"]);
    expect(m.buttons[0].action).toEqual({
      type: "answer_request",
      requestId: "r1",
      answer: "Only words",
    });
    expect(m.link).toEqual({ type: "request", id: "r1" });
    expect(m).toMatchObject({ kind: "request", refId: "r1" });
  });

  it("shows at most two of the attachments", () => {
    expect(requestArrived(request, images).attachments).toHaveLength(2);
  });

  it("offers Looks right and Fix it when nothing is unclear", () => {
    const m = requestArrived({ ...request, openQuestion: null }, []);
    expect(m.text).toBe("Maren asked to replace the page 2 text on Alder House.");
    expect(m.buttons).toEqual([
      { label: "Looks right", action: { type: "confirm_request", requestId: "r1" } },
      { label: "Fix it", action: { type: "fix_request", requestId: "r1" } },
    ]);
  });

  it("never offers more than three buttons, and keeps an option that asks the person out of the answers", () => {
    const m = requestArrived(
      { ...request, openQuestion: { text: "Which?", options: ["A", "B", "C", "D"] } },
      [],
    );
    expect(m.buttons).toHaveLength(3);
  });

  it("reports a reply to a waiting ask, with a way to close it", () => {
    const m = replyArrived(
      { id: "t-ask", title: "Words or type?" },
      "Maren said only the words.",
      "b7",
    );
    expect(m.text).toBe("Maren said only the words.");
    expect(m.buttons).toEqual([{ label: "Close", action: { type: "close_ask", taskId: "t-ask" } }]);
    expect(m).toMatchObject({ kind: "reply", refId: "b7", link: { type: "task", id: "t-ask" } });
  });

  it("reports a reply that matched no waiting ask without a button", () => {
    const m = replyArrived(null, "Maren sent the logo.", "b8");
    expect(m.buttons).toEqual([]);
    expect(m.link).toBeNull();
  });

  it("words a reminder as the task and the fact, with the action for its kind", () => {
    const m = reminderDue(
      { id: "rem1", fireAt: "2026-11-14T17:00:00Z" },
      { id: "t1", kind: "do", title: "Homepage photo swap" },
      "Maren asked for this by today.",
    );
    expect(m.text).toBe("Homepage photo swap. Maren asked for this by today.");
    expect(m.buttons.map((b) => b.label)).toEqual(["Start", "Done", "Tomorrow"]);
    expect(m.buttons[1].action).toEqual({ type: "task_state", taskId: "t1", state: "done" });
    expect(m.buttons[2].action).toEqual({ type: "snooze", taskId: "t1", days: 1 });
    expect(m).toMatchObject({
      kind: "reminder",
      refId: "rem1:2026-11-14T17:00:00Z",
      link: { type: "task", id: "t1" },
    });
  });

  // A snoozed reminder is the same row with a new time; it must be said again.
  it("treats the same reminder firing at a new time as a new thing to say", () => {
    const task = { id: "t1", kind: "do" as const, title: "x" };
    const first = reminderDue({ id: "rem1", fireAt: "2026-11-14T17:00:00Z" }, task, "Due today.");
    const again = reminderDue({ id: "rem1", fireAt: "2026-11-15T17:00:00Z" }, task, "Due today.");
    expect(first.refId).not.toBe(again.refId);
  });

  it("offers Send for a message to write and Got it for an errand", () => {
    const tell = reminderDue(
      { id: "x", fireAt: "t" },
      { id: "t2", kind: "tell", title: "Tell Maren it's live" },
      "Due today.",
    );
    expect(tell.buttons.map((b) => b.label)).toEqual(["Send", "Tomorrow"]);
    expect(tell.buttons[0].action).toEqual({ type: "open", link: { type: "task", id: "t2" } });
    const get = reminderDue(
      { id: "y", fireAt: "t" },
      { id: "t3", kind: "get", title: "Framing supplies" },
      "Due today.",
    );
    expect(get.buttons.map((b) => b.label)).toEqual(["Got it", "Tomorrow"]);
  });

  it("does not double the full stop when a title already ends with one", () => {
    const m = reminderDue(
      { id: "x", fireAt: "t" },
      { id: "t", kind: "do", title: "Send invoice." },
      "Due today.",
    );
    expect(m.text).toBe("Send invoice. Due today.");
  });

  it("says a task is ready when what it waited for is finished", () => {
    const m = taskUnblocked({ id: "t2", kind: "do", title: "Replace page 2 copy" });
    expect(m.text).toBe("Replace page 2 copy is ready.");
    expect(m.buttons.map((b) => b.label)).toEqual(["Start"]);
    expect(m).toMatchObject({ kind: "unblocked", refId: "t2" });
  });

  it("counts the back burner in one sentence, once per week", () => {
    const m = weeklyReview(6, "2026-11-15");
    expect(m.text).toBe("6 things on the back burner.");
    expect(m.buttons.map((b) => b.label)).toEqual(["Review", "Skip"]);
    expect(m).toMatchObject({ kind: "review", refId: "2026-11-15" });
    expect(weeklyReview(1, "2026-11-15").text).toBe("1 thing on the back burner.");
  });

  it("says plainly when reminders are not getting through", () => {
    const m = pushNotWorking("2026-11-14");
    expect(m.text).toBe("Notifications are not reaching your phone.");
    expect(m.buttons).toEqual([
      { label: "Fix", action: { type: "open", link: { type: "setup" } } },
    ]);
    expect(m).toMatchObject({ kind: "health", refId: "2026-11-14" });
  });

  it("shows a learned rule with an Undo", () => {
    const m = ruleLearned({ id: "rule1", sentence: 'For Maren, "writing" means the words.' });
    expect(m.text).toBe('Learned: For Maren, "writing" means the words.');
    expect(m.buttons).toEqual([{ label: "Undo", action: { type: "undo_rule", ruleId: "rule1" } }]);
    expect(m).toMatchObject({ kind: "rule", refId: "rule1" });
  });

  const projects = [
    { id: "pr1", name: "Alder House" },
    { id: "pr2", name: "Studio prints for the spring show" },
    { id: "pr3", name: "Portfolio" },
    { id: "pr4", name: "Fourth" },
  ];

  it("asks what she is on at the start of the day, offering her projects", () => {
    const m = checkIn("start", { date: "2026-11-16", ordinal: 0, focus: null, projects });
    expect(m.text).toBe("What are you on today?");
    // Never more than three, and a long name is cut to two words.
    expect(m.buttons.map((b) => b.label)).toEqual(["Alder House", "Studio prints", "Portfolio"]);
    expect(m.buttons[0].action).toEqual({ type: "set_focus", projectId: "pr1" });
    expect(m).toMatchObject({ kind: "checkin", refId: "2026-11-16:start" });
  });

  it("asks whether she is still on the same thing, by name, with the other projects one tap away", () => {
    const m = checkIn("during", { date: "2026-11-16", ordinal: 1, focus: projects[0], projects });
    expect(m.text).toBe("Still on Alder House?");
    // "Yes" keeps the focus; the others change it. Nothing leaves the old focus silently in place.
    expect(m.buttons.map((b) => b.label)).toEqual(["Yes", "Studio prints", "Portfolio"]);
    expect(m.buttons[0].action).toEqual({ type: "set_focus", projectId: "pr1" });
    expect(m.buttons[1].action).toEqual({ type: "set_focus", projectId: "pr2" });
    expect(m.refId).toBe("2026-11-16:during:1");
  });

  it("keys a mid-day check-in on its place in the day, so two runs in one window say it once", () => {
    const a = checkIn("during", { date: "2026-11-16", ordinal: 2, focus: null, projects });
    const b = checkIn("during", { date: "2026-11-16", ordinal: 2, focus: projects[0], projects });
    expect(a.refId).toBe(b.refId);
  });

  it("asks what she is on mid-day when it does not know", () => {
    const m = checkIn("during", { date: "2026-11-16", ordinal: 1, focus: null, projects });
    expect(m.text).toBe("What are you on?");
    expect(m.buttons).toHaveLength(3);
  });

  it("asks for a photo at the end of the day", () => {
    const m = checkIn("end", { date: "2026-11-16", ordinal: 3, focus: projects[0], projects });
    expect(m.text).toBe("Photo of where you got to?");
    expect(m.buttons).toEqual([
      { label: "Add photo", action: { type: "open", link: { type: "camera" } } },
      { label: "Skip", action: { type: "dismiss" } },
    ]);
    expect(m.refId).toBe("2026-11-16:end");
  });

  it("says where a photo was filed, with the other projects as a way to move it", () => {
    const m = progressFiled({ id: "e1" }, projects[0], projects);
    expect(m.text).toBe("Filed under Alder House.");
    expect(m.buttons.map((b) => b.label)).toEqual(["Studio prints", "Portfolio"]);
    expect(m.buttons[0].action).toEqual({ type: "file_progress", entryId: "e1", projectId: "pr2" });
    expect(m).toMatchObject({
      kind: "progress",
      refId: "e1",
      link: { type: "project", id: "pr1" },
    });
  });

  it("asks which project a photo is for when it cannot tell", () => {
    const m = progressAsk({ id: "e1" }, projects);
    expect(m.text).toBe("Which project is this photo for?");
    expect(m.buttons).toHaveLength(3);
    expect(m.buttons[2].action).toEqual({ type: "file_progress", entryId: "e1", projectId: "pr3" });
    expect(m).toMatchObject({ kind: "progress", refId: "e1" });
  });

  describe("the website task runner", () => {
    const task = { id: "t1", title: "Move the sconces up on page 2" };
    const run = (over: Partial<CoachRun> = {}): CoachRun => ({
      id: "run1",
      taskId: "t1",
      status: "done",
      note: null,
      summary: "Moved the sconce photos above the paragraph on the Lighting page.",
      branch: "cliphy/run1-move-the-sconces-up",
      prUrl: "https://github.com/example/alder-house/pull/3",
      previewUrl: "https://run1.alder-house.pages.dev",
      pictures: [
        { label: "before", width: "desktop", storagePath: "coach/u/bd.png" },
        { label: "before", width: "phone", storagePath: "coach/u/bp.png" },
        { label: "after", width: "desktop", storagePath: "coach/u/ad.png" },
        { label: "after", width: "phone", storagePath: "coach/u/ap.png" },
      ],
      error: null,
      createdAt: "2026-11-15T09:00:00Z",
      claimedAt: null,
      finishedAt: null,
      ...over,
    });

    it("offers to start a task on the site", () => {
      expect(startOnSite("t1")).toEqual({
        label: "Start on the site",
        action: { type: "start_run", taskId: "t1" },
      });
    });

    it("can put buttons on a plain line about what it did", () => {
      expect(didAction("Saved. 2 tasks added", [startOnSite("t1")]).buttons).toEqual([
        startOnSite("t1"),
      ]);
      expect(didAction("Saved").buttons).toEqual([]);
    });

    it("offers both ways to start work that is ready and can be done on the site", () => {
      const m = taskUnblocked({ id: "t1", kind: "do", title: task.title }, { runnable: true });
      expect(m.buttons).toEqual([
        { label: "Start", action: { type: "open", link: { type: "task", id: "t1" } } },
        startOnSite("t1"),
      ]);
    });

    it("says a run started, once per run, with a way to stop it", () => {
      expect(runStarted({ id: "run1" }, task)).toEqual({
        text: 'Started on the site: "Move the sconces up on page 2"',
        buttons: [{ label: "Stop", action: { type: "stop_run", runId: "run1" } }],
        link: { type: "task", id: "t1" },
        attachments: [],
        kind: "run_started",
        refId: "run1",
      });
    });

    it("shows a finished run: what changed, after and before on a phone, and the links", () => {
      expect(runFinished(run(), task)).toEqual({
        text:
          "Done: Moved the sconce photos above the paragraph on the Lighting page.\n" +
          "Preview: https://run1.alder-house.pages.dev\n" +
          "Pull request: https://github.com/example/alder-house/pull/3",
        buttons: [],
        link: { type: "task", id: "t1" },
        attachments: [
          { storagePath: "coach/u/ap.png", mediaType: "image/png" },
          { storagePath: "coach/u/bp.png", mediaType: "image/png" },
        ],
        kind: "run_finished",
        refId: "run1",
      });
    });

    it("says so when there was no preview, and shows no pictures it does not have", () => {
      const m = runFinished(run({ previewUrl: null, pictures: [] }), task);
      expect(m.text).toBe(
        "Done: Moved the sconce photos above the paragraph on the Lighting page.\n" +
          "No preview was found.\n" +
          "Pull request: https://github.com/example/alder-house/pull/3",
      );
      expect(m.attachments).toEqual([]);
    });

    it("says what went wrong in plain words, with the work if any was kept", () => {
      const failed = { status: "failed" as const, summary: null, previewUrl: null, pictures: [] };
      expect(
        runFinished(
          run({ ...failed, error: "I could not find a page 2.", prUrl: null, branch: null }),
          task,
        ).text,
      ).toBe("That didn't work: I could not find a page 2.");
      expect(
        runFinished(run({ ...failed, error: "Could not open the pull request." }), task).text,
      ).toBe(
        "That didn't work: Could not open the pull request.\n" +
          "Pull request: https://github.com/example/alder-house/pull/3",
      );
      expect(
        runFinished(run({ ...failed, error: "The preview broke.", prUrl: null }), task).text,
      ).toBe("That didn't work: The preview broke.\nBranch: cliphy/run1-move-the-sconces-up");
    });

    it("says a stopped run stopped", () => {
      const m = runFinished(run({ status: "cancelled" }), task);
      expect(m).toMatchObject({ text: "Stopped.", attachments: [], kind: "run_finished" });
    });

    it("says once when nothing has picked a run up", () => {
      expect(runnerQuiet({ id: "run1" })).toMatchObject({
        text: "The runner doesn't seem to be on.",
        kind: "runner_quiet",
        refId: "run1",
        buttons: [],
      });
    });
  });
});
