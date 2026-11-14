import type { ProposedTask, TaskKind, TaskKit, TaskState } from "@cliphy/shared";

export interface TaskInsert {
  kind: TaskKind;
  title: string;
  kit: TaskKit;
  withPerson: boolean;
  /** Index, within the returned list, of the task this one waits for. */
  afterIndex: number | null;
  position: number;
}

/**
 * Turn a request's proposed chain into the tasks to create.
 *
 * When the open question was answered at confirm time, the `ask` that existed
 * only to settle it is dropped, and anything waiting on it waits instead on
 * whatever that ask itself waited for.
 */
export function materializeChain(
  proposed: ProposedTask[],
  opts: { answered: boolean },
): TaskInsert[] {
  const dropped = opts.answered ? proposed.findIndex((t) => t.answersQuestion) : -1;

  const newIndex = new Map<number, number>();
  proposed.forEach((_, i) => {
    if (i !== dropped) newIndex.set(i, newIndex.size);
  });

  const out: TaskInsert[] = [];
  proposed.forEach((task, i) => {
    if (i === dropped) return;
    let after = task.after;
    if (after !== null && after === dropped) after = proposed[dropped].after;
    out.push({
      kind: task.kind,
      title: task.title,
      kit: task.kit,
      withPerson: task.withPerson,
      afterIndex: after !== null ? (newIndex.get(after) ?? null) : null,
      position: out.length,
    });
  });
  return out;
}

/** A task is blocked while the task it waits for is still open or waiting. */
export function isBlocked(
  task: { afterTaskId: string | null },
  byId: Map<string, { state: TaskState }>,
): boolean {
  if (!task.afterTaskId) return false;
  const before = byId.get(task.afterTaskId);
  return before !== undefined && (before.state === "open" || before.state === "waiting");
}

/** What "sent" does: an ask now waits on the other person, a tell is finished. */
export function stateAfterSent(kind: TaskKind): TaskState | null {
  if (kind === "ask") return "waiting";
  if (kind === "tell") return "done";
  return null;
}
