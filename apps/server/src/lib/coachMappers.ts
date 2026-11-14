import type {
  Attachment,
  ChecklistItem,
  CoachRequest,
  CoachTask,
  InboundMessage,
  OpenQuestion,
  Person,
  Project,
  ProposedTask,
  TaskKit,
} from "@cliphy/shared";

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function toPerson(row: Row): Person {
  return {
    id: row.id as string,
    name: row.name as string,
    role: row.role as Person["role"],
    handles: (row.handles as string[]) ?? [],
    captureThread: Boolean(row.capture_thread),
    historyWindow: (row.history_window as Person["historyWindow"]) ?? "new",
    historyDays: (row.history_days as number) ?? null,
  };
}

export function toProject(row: Row, personIds: string[]): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    tag: row.tag as string,
    active: row.active !== false,
    stateLine: (row.state_line as string) ?? "",
    personIds,
  };
}

export function toMessage(row: Row): InboundMessage {
  return {
    id: row.id as string,
    personId: row.person_id as string,
    channel: row.channel as InboundMessage["channel"],
    direction: row.direction as InboundMessage["direction"],
    text: (row.text as string) ?? "",
    attachments: (row.attachments as Attachment[]) ?? [],
    sentAt: row.sent_at as string,
  };
}

export function toRequest(row: Row): CoachRequest {
  return {
    id: row.id as string,
    bundleId: row.bundle_id as string,
    projectId: str(row.project_id),
    personId: row.person_id as string,
    understood: (row.understood as string) ?? "",
    openQuestion: (row.open_question as OpenQuestion) ?? null,
    answer: str(row.answer),
    status: row.status as CoachRequest["status"],
    replacesId: str(row.replaces_id),
    proposedReplacesId: str(row.proposed_replaces_id),
    proposedTasks: (row.proposed_tasks as ProposedTask[]) ?? [],
    dueDate: str(row.due_date),
    historical: Boolean(row.historical),
    createdAt: row.created_at as string,
    confirmedAt: str(row.confirmed_at),
  };
}

export function toTask(row: Row, blocked: boolean): CoachTask {
  return {
    id: row.id as string,
    requestId: str(row.request_id),
    projectId: str(row.project_id),
    kind: row.kind as CoachTask["kind"],
    state: row.state as CoachTask["state"],
    title: row.title as string,
    kit: (row.kit as TaskKit) ?? {},
    withPersonId: str(row.with_person_id),
    afterTaskId: str(row.after_task_id),
    blocked,
    dueDate: str(row.due_date),
    // Postgres returns a `time` as HH:MM:SS; the API speaks HH:MM both ways.
    dueTime: str(row.due_time)?.slice(0, 5) ?? null,
    place: str(row.place),
    checklist: (row.checklist as ChecklistItem[]) ?? [],
    replyBundleId: str(row.reply_bundle_id),
    createdAt: row.created_at as string,
    doneAt: str(row.done_at),
  };
}
