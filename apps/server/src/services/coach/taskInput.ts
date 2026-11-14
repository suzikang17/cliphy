import { TASK_KINDS, type ChecklistItem, type CoachTask, type TaskKind } from "@cliphy/shared";
import { supabase } from "../../lib/supabase.js";
import { toTask } from "../../lib/coachMappers.js";
import { syncTaskReminders } from "./reminders.js";

// Validating and creating tasks. Shared by the HTTP route and the chat agent.

type Row = Record<string, unknown>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** YYYY-MM-DD that names a day that exists (2026-13-45 has the right shape but does not). */
export function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parseChecklist(raw: unknown): ChecklistItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: ChecklistItem[] = [];
  for (const item of raw as Row[]) {
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (!text) return null;
    items.push({ text, done: item.done === true });
  }
  return items;
}

export interface TaskBody {
  kind?: unknown;
  title?: unknown;
  state?: unknown;
  projectId?: unknown;
  withPersonId?: unknown;
  dueDate?: unknown;
  dueTime?: unknown;
  place?: unknown;
  checklist?: unknown;
  kit?: unknown;
}

/**
 * Validate the fields shared by create and update into column values.
 * `kind` is the task's kind (from the body on create, from the row on update)
 * and `currentDate` the date it has now, so a time can be checked against it.
 */
export function taskColumns(
  body: TaskBody,
  kind: TaskKind,
  currentDate: string | null,
): { error: string } | { values: Row } {
  const values: Row = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return { error: "title is required" };
    values.title = title;
  }

  let date = currentDate;
  if (body.dueDate !== undefined) {
    if (body.dueDate === null) {
      date = null;
      values.due_date = null;
      values.due_time = null; // a time means nothing without its date
    } else if (typeof body.dueDate === "string" && isRealDate(body.dueDate)) {
      date = body.dueDate;
      values.due_date = date;
    } else {
      return { error: "dueDate must be YYYY-MM-DD" };
    }
  }
  if (body.dueTime !== undefined && body.dueTime !== null) {
    if (typeof body.dueTime !== "string" || !TIME.test(body.dueTime)) {
      return { error: "dueTime must be HH:MM" };
    }
    if (!date) return { error: "dueTime needs a dueDate" };
    values.due_time = body.dueTime;
  } else if (body.dueTime === null) {
    values.due_time = null;
  }

  if (body.place !== undefined || body.checklist !== undefined) {
    if (kind !== "get") return { error: "place and checklist are for get tasks" };
    if (body.place !== undefined) {
      values.place = typeof body.place === "string" && body.place.trim() ? body.place.trim() : null;
    }
    if (body.checklist !== undefined) {
      const checklist = parseChecklist(body.checklist);
      if (!checklist) return { error: "checklist must be a list of { text, done }" };
      values.checklist = checklist;
    }
  }

  if (body.kit !== undefined) {
    if (typeof body.kit !== "object" || body.kit === null || Array.isArray(body.kit)) {
      return { error: "kit must be an object" };
    }
    values.kit = body.kit;
  }
  return { values };
}

/** `id` if it names a row of `table` owned by the user, else null. */
export async function ownId(table: string, id: unknown, userId: string): Promise<string | null> {
  if (typeof id !== "string") return null;
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? id : null;
}

export type CreateTaskResult =
  | { status: 201; body: { task: CoachTask } }
  | { status: 400 | 500; body: { error: string } };

/** Create a task the user asked for directly (no request behind it), with its reminders. */
export async function createTask(userId: string, body: TaskBody): Promise<CreateTaskResult> {
  if (!TASK_KINDS.includes(body.kind as TaskKind)) {
    return { status: 400, body: { error: "kind must be do, tell, ask or get" } };
  }
  const kind = body.kind as TaskKind;
  if (body.title === undefined) return { status: 400, body: { error: "title is required" } };
  const parsed = taskColumns(body, kind, null);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error } };

  let projectId: string | null = null;
  if (body.projectId !== undefined && body.projectId !== null) {
    projectId = await ownId("coach_projects", body.projectId, userId);
    if (!projectId) return { status: 400, body: { error: "project not found" } };
  }
  let withPersonId: string | null = null;
  if (body.withPersonId !== undefined && body.withPersonId !== null) {
    withPersonId = await ownId("coach_people", body.withPersonId, userId);
    if (!withPersonId) return { status: 400, body: { error: "person not found" } };
  }

  const { data, error } = await supabase
    .from("coach_tasks")
    .insert({
      user_id: userId,
      request_id: null,
      project_id: projectId,
      with_person_id: withPersonId,
      kind,
      ...parsed.values,
    })
    .select("*")
    .single();
  if (error || !data) return { status: 500, body: { error: "Failed to create task" } };
  await syncTaskReminders(userId, [(data as Row).id as string]);
  return { status: 201, body: { task: toTask(data as Row, false) } };
}
