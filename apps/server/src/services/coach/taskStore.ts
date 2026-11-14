import type { CoachTask, TaskState } from "@cliphy/shared";
import { supabase } from "../../lib/supabase.js";
import { toTask } from "../../lib/coachMappers.js";
import { isBlocked } from "./chain.js";

type Row = Record<string, unknown>;

/** All of a user's tasks. `blocked` depends on other tasks, so it needs the whole set. */
export async function loadTasks(userId: string): Promise<{ rows: Row[]; tasks: CoachTask[] }> {
  const { data } = await supabase.from("coach_tasks").select("*").eq("user_id", userId);
  const rows = (data as Row[]) ?? [];
  const byId = new Map(rows.map((r) => [r.id as string, { state: r.state as TaskState }]));
  const tasks = rows.map((r) =>
    toTask(r, isBlocked({ afterTaskId: (r.after_task_id as string) ?? null }, byId)),
  );
  return { rows, tasks };
}
