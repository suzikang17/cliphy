import type { ChatAction, CoachTask, TaskState } from "@cliphy/shared";
import { supabase } from "../../lib/supabase.js";
import { stateAfterSent } from "./chain.js";
import { taskUnblocked } from "./botMessages.js";
import { postBotMessage } from "./chat.js";
import { loadSettings, syncTaskReminders } from "./reminders.js";
import { announceAnswer, confirmRequest } from "./requestActions.js";
import { loadTasks } from "./taskStore.js";
import { addDays, localParts } from "./time.js";

// What the bot can do on the user's behalf. A chat button and the chat agent
// both end up here, so a tap and a typed instruction behave the same.

/** `say` is the one short line reporting what happened, or null when nothing needs saying. */
export interface ActionResult {
  changed: boolean;
  say: string | null;
}

const NOTHING: ActionResult = { changed: false, say: null };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Tell the user about tasks that were waiting on `taskId` and can now start. */
export async function announceUnblocked(
  userId: string,
  taskId: string,
  tasks: CoachTask[],
): Promise<void> {
  for (const t of tasks) {
    if (t.afterTaskId === taskId && t.state === "open") {
      await postBotMessage(userId, taskUnblocked(t));
    }
  }
}

export async function setTaskState(
  userId: string,
  taskId: string,
  state: Exclude<TaskState, "waiting">,
): Promise<ActionResult> {
  const { tasks } = await loadTasks(userId);
  const task = tasks.find((t) => t.id === taskId);
  if (!task || task.state === state) return NOTHING;
  if (state === "done" && task.blocked)
    return { changed: false, say: "That is still waiting on something." };

  const { data } = await supabase
    .from("coach_tasks")
    .update({ state, done_at: state === "done" ? new Date().toISOString() : null })
    .eq("id", taskId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (!data) return NOTHING;

  await syncTaskReminders(userId, [taskId]);
  if (state === "done" || state === "dropped") await announceUnblocked(userId, taskId, tasks);
  return {
    changed: true,
    say: state === "done" ? "Done." : state === "dropped" ? "Dropped." : "Reopened.",
  };
}

export async function markTaskSent(userId: string, taskId: string): Promise<ActionResult> {
  const { tasks } = await loadTasks(userId);
  const task = tasks.find((t) => t.id === taskId);
  const next = task ? stateAfterSent(task.kind) : null;
  if (!task || !next || task.blocked || (task.state !== "open" && task.state !== "waiting")) {
    return NOTHING;
  }
  const { data } = await supabase
    .from("coach_tasks")
    .update({ state: next, done_at: next === "done" ? new Date().toISOString() : null })
    .eq("id", taskId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (!data) return NOTHING;
  await syncTaskReminders(userId, [taskId]);
  if (next === "done") await announceUnblocked(userId, taskId, tasks);
  return { changed: true, say: "Sent." };
}

/** Move a task `days` on from its date, or from today if it is overdue or undated. */
export async function snoozeTask(
  userId: string,
  taskId: string,
  days: number,
): Promise<ActionResult> {
  const { tasks } = await loadTasks(userId);
  const task = tasks.find((t) => t.id === taskId);
  if (!task || (task.state !== "open" && task.state !== "waiting")) return NOTHING;

  const { timezone } = await loadSettings(userId);
  const today = localParts(new Date(), timezone).date;
  const from = task.dueDate && task.dueDate > today ? task.dueDate : today;
  const to = addDays(from, Math.max(1, Math.round(days)));

  const { data } = await supabase
    .from("coach_tasks")
    .update({ due_date: to })
    .eq("id", taskId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (!data) return NOTHING;
  await syncTaskReminders(userId, [taskId]);

  const [, m, d] = to.split("-").map(Number);
  const name =
    to <= addDays(today, 6)
      ? DAYS[new Date(`${to}T00:00:00Z`).getUTCDay()]
      : `${d} ${MONTHS[m - 1]}`;
  return { changed: true, say: `Moved to ${name}.` };
}

async function undoRule(userId: string, ruleId: string): Promise<ActionResult> {
  const { data } = await supabase
    .from("coach_rules")
    .update({ active: false })
    .eq("id", ruleId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  return data ? { changed: true, say: "Forgotten." } : NOTHING;
}

async function confirm(
  userId: string,
  requestId: string,
  answer: string | null,
): Promise<ActionResult> {
  const before = await supabase
    .from("coach_requests")
    .select("status")
    .eq("id", requestId)
    .eq("user_id", userId)
    .maybeSingle();
  // Only the confirm that actually happens gets reported; a repeat says nothing.
  if ((before.data as { status?: string } | null)?.status !== "new") return NOTHING;

  const result = await confirmRequest(userId, requestId, answer ? { answer } : {});
  if (result.status !== 200) return NOTHING;
  if (answer) await announceAnswer(userId, requestId);
  const n = result.body.tasks.length;
  return {
    changed: true,
    say: n === 0 ? "Saved." : `Saved. ${n} ${n === 1 ? "task" : "tasks"} added.`,
  };
}

/** Carry out a chat button's action for this user. Every id is checked against the user. */
export async function executeAction(userId: string, action: ChatAction): Promise<ActionResult> {
  switch (action.type) {
    case "answer_request":
      return confirm(userId, action.requestId, action.answer);
    case "confirm_request":
      return confirm(userId, action.requestId, null);
    case "fix_request":
      // The correction itself is what the user types next.
      return { changed: false, say: "What did I get wrong?" };
    case "task_state":
      return setTaskState(userId, action.taskId, action.state);
    case "task_sent":
      return markTaskSent(userId, action.taskId);
    case "snooze":
      return snoozeTask(userId, action.taskId, action.days);
    case "close_ask": {
      const result = await setTaskState(userId, action.taskId, "done");
      return result.changed ? { changed: true, say: "Closed." } : result;
    }
    case "undo_rule":
      return undoRule(userId, action.ruleId);
    case "open":
    case "dismiss":
      return NOTHING;
  }
}
