import {
  isRunnable,
  type ChatAction,
  type ChatButton,
  type CoachTask,
  type TaskState,
  type ChatLink,
} from "@cliphy/shared";
import { supabase } from "../../lib/supabase.js";
import { stateAfterSent } from "./chain.js";
import { startOnSite, taskUnblocked } from "./botMessages.js";
import { postBotMessage } from "./chat.js";
import { projectTag } from "./projectTag.js";
import { loadSettings, syncTaskReminders } from "./reminders.js";
import { announceAnswer, confirmRequest } from "./requestActions.js";
import { cancelRun, reposByProject, startRun } from "./runs.js";
import { loadTasks } from "./taskStore.js";
import { addDays, localParts } from "./time.js";

// What the bot can do on the user's behalf. A chat button and the chat agent
// both end up here, so a tap and a typed instruction behave the same.

/** `say` is the one short line reporting what happened, or null when nothing needs saying. */
export interface ActionResult {
  changed: boolean;
  say: string | null;
  /**
   * The tap should not count: the action could not be done now, or it only
   * asked a follow-up. The button becomes tappable again.
   */
  release?: boolean;
  /** What the user can do next, offered on the line that reports what happened. */
  buttons?: ChatButton[];
  /** What was made or changed, so the line that reports it leads there. */
  links?: ChatLink[];
}

const NOTHING: ActionResult = { changed: false, say: null };
export const FAILED: ActionResult = {
  changed: false,
  say: "That didn't work. Try again.",
  release: true,
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Tell the user about tasks that were waiting on `taskId` and can now start. */
export async function announceUnblocked(
  userId: string,
  taskId: string,
  tasks: CoachTask[],
): Promise<void> {
  const ready = tasks.filter((t) => t.afterTaskId === taskId && t.state === "open");
  // Only work can be started on the site, and only in a project with a repo.
  const repos = ready.some((t) => t.kind === "do") ? await reposByProject(userId) : new Map();
  for (const t of ready) {
    const project = t.projectId ? { repo: repos.get(t.projectId) ?? null } : null;
    // It was waiting on `taskId` alone, so it is no longer blocked.
    const runnable = isRunnable({ ...t, blocked: false }, project);
    await postBotMessage(userId, taskUnblocked(t, { runnable }));
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
  if (state === "done" && task.blocked) {
    return { changed: false, say: "That is still waiting on something.", release: true };
  }

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
  if (result.status !== 200) return FAILED;
  if (answer) await announceAnswer(userId, requestId);
  const tasks = result.body.tasks;
  const n = tasks.length;
  // Work that can start on the site right now gets its button here. Work still
  // waiting on a question gets it when it becomes ready.
  const repos = tasks.some((t) => t.kind === "do") ? await reposByProject(userId) : new Map();
  const first = tasks.find((t) =>
    isRunnable(t, t.projectId ? { repo: repos.get(t.projectId) ?? null } : null),
  );
  return {
    changed: true,
    say: n === 0 ? "Saved." : `Saved. ${n} ${n === 1 ? "task" : "tasks"} added.`,
    buttons: first ? [startOnSite(first.id)] : [],
    // Where it all went: the project, then each task by name.
    links: [
      ...(await projectLink(userId, result.body.request.projectId)),
      ...tasks.slice(0, 3).map((t) => ({ type: "task" as const, id: t.id, label: t.title })),
    ],
  };
}

/** The tap that starts a website change. The started message is said by the run itself. */
async function startOnTheSite(userId: string, taskId: string): Promise<ActionResult> {
  const result = await startRun(userId, taskId);
  if (result.status === 201) return { changed: true, say: null };
  if (result.status === 200) return NOTHING; // One is already going.
  if (result.status === 500) return FAILED;
  return { changed: false, say: "That task can't be started on the site.", release: true };
}

async function stopRun(userId: string, runId: string): Promise<ActionResult> {
  const result = await cancelRun(userId, runId);
  return result?.changed ? { changed: true, say: null } : NOTHING;
}

/** "I'm on this": what she is working on now. The strongest clue for filing a photo. */
export async function setFocus(userId: string, projectId: string): Promise<ActionResult> {
  const { data } = await supabase
    .from("coach_projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  const project = data as { id: string; name: string } | null;
  if (!project) return NOTHING;
  await supabase
    .from("coach_settings")
    .upsert(
      { user_id: userId, focus_project_id: project.id, focus_set_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  return { changed: true, say: `On ${project.name}.` };
}

/** Put a progress photo in a project, or move it; its Library clip's project tag follows. */
export async function fileProgressEntry(
  userId: string,
  entryId: string,
  projectId: string,
): Promise<ActionResult> {
  const [{ data: entryRow }, { data: projectRow }] = await Promise.all([
    supabase
      .from("coach_progress")
      .select("*")
      .eq("id", entryId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("coach_projects")
      .select("id, name, tag")
      .eq("id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const entry = entryRow as {
    id: string;
    project_id: string | null;
    clip_id: string | null;
  } | null;
  const project = projectRow as { id: string; name: string; tag: string } | null;
  if (!entry || !project || entry.project_id === project.id) return NOTHING;

  await supabase
    .from("coach_progress")
    .update({ project_id: project.id })
    .eq("id", entryId)
    .eq("user_id", userId);

  if (entry.clip_id) {
    const [{ data: clip }, { data: allProjects }] = await Promise.all([
      supabase
        .from("clips")
        .select("id, tags")
        .eq("id", entry.clip_id)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("coach_projects").select("tag").eq("user_id", userId),
    ]);
    if (clip) {
      // One project tag per photo: drop whichever it had, add the new one.
      const projectTags = new Set(((allProjects as { tag: string }[]) ?? []).map((p) => p.tag));
      const kept = (((clip as { tags: string[] | null }).tags ?? []) as string[]).filter(
        (t) => !projectTags.has(t),
      );
      await supabase
        .from("clips")
        .update({ tags: [...kept, project.tag] })
        .eq("id", entry.clip_id)
        .eq("user_id", userId);
    }
  }
  return {
    changed: true,
    say: entry.project_id ? `Moved to ${project.name}.` : `Filed under ${project.name}.`,
  };
}

/** A link to a project by its name, or nothing when there is none. */
async function projectLink(userId: string, projectId: string | null): Promise<ChatLink[]> {
  if (!projectId) return [];
  const { data } = await supabase
    .from("coach_projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  const project = data as { id: string; name: string } | null;
  return project ? [{ type: "project", id: project.id, label: project.name }] : [];
}

const requestsWord = (n: number) => `${n} ${n === 1 ? "request" : "requests"}`;

/** Move every request waiting on a proposed project name to `projectId` (or to none). */
async function moveProposed(
  userId: string,
  name: string,
  projectId: string | null,
): Promise<{ count: number; personIds: string[] }> {
  const { data: waiting } = await supabase
    .from("coach_requests")
    .select("id, person_id")
    .eq("user_id", userId)
    .eq("proposed_project", name);
  const rows = (waiting as { id: string; person_id: string }[]) ?? [];
  if (rows.length > 0) {
    await supabase
      .from("coach_requests")
      .update({ project_id: projectId, proposed_project: null })
      .eq("user_id", userId)
      .eq("proposed_project", name);
  }
  return { count: rows.length, personIds: [...new Set(rows.map((r) => r.person_id))] };
}

/** "Create": make the project the bot proposed and file under it what was waiting. */
async function createProposedProject(userId: string, name: string): Promise<ActionResult> {
  const tag = projectTag(name);
  if (tag === "project:") return FAILED;
  const { data: created } = await supabase
    .from("coach_projects")
    .insert({ user_id: userId, name, tag })
    .select("id, name, tag")
    .single();
  let project = created as { id: string; name: string } | null;
  if (!project) {
    // Made in the meantime (or by hand): use that one.
    const { data: existing } = await supabase
      .from("coach_projects")
      .select("id, name")
      .eq("user_id", userId)
      .eq("tag", tag)
      .maybeSingle();
    project = existing as { id: string; name: string } | null;
  }
  if (!project) return FAILED;

  const { count, personIds } = await moveProposed(userId, name, project.id);
  if (personIds.length > 0) {
    await supabase.from("coach_project_people").upsert(
      personIds.map((person_id) => ({ project_id: project.id, person_id })),
      { onConflict: "project_id,person_id", ignoreDuplicates: true },
    );
  }
  return {
    changed: true,
    say: `Made ${project.name}. ${requestsWord(count)} filed.`,
    links: [{ type: "project", id: project.id, label: project.name }],
  };
}

/** File what was waiting on a proposed name under an existing project, or under none. */
async function fileProposed(
  userId: string,
  name: string,
  projectId: string | null,
): Promise<ActionResult> {
  if (projectId === null) {
    await moveProposed(userId, name, null);
    return { changed: true, say: "Left without a project." };
  }
  const [link] = await projectLink(userId, projectId);
  if (!link) return FAILED;
  const { count } = await moveProposed(userId, name, projectId);
  return {
    changed: true,
    say: `${requestsWord(count)} filed under ${link.label}.`,
    links: [link],
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
      return { changed: false, say: "What did I get wrong?", release: true };
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
    case "set_focus":
      return setFocus(userId, action.projectId);
    case "file_progress":
      return fileProgressEntry(userId, action.entryId, action.projectId);
    case "start_run":
      return startOnTheSite(userId, action.taskId);
    case "stop_run":
      return stopRun(userId, action.runId);
    case "create_project":
      return createProposedProject(userId, action.name);
    case "file_proposed":
      return fileProposed(userId, action.name, action.projectId);
    case "open":
    case "dismiss":
      return NOTHING;
  }
}
