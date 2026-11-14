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
} from "../botMessages.js";

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
    expect(m.text).toBe("Reminders are not reaching your phone.");
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
});
