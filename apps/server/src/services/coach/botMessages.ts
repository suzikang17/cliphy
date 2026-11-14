import {
  MAX_CHAT_BUTTONS,
  type Attachment,
  type ChatButton,
  type ChatKind,
  type ChatLink,
  type OpenQuestion,
  type TaskKind,
} from "@cliphy/shared";

/**
 * Everything the bot says, in one place.
 *
 * Copy rules: state the fact and stop; keep who asked, what for and by when;
 * buttons are one or two words and carry the choices; never more than three.
 * `kind` + `refId` identify what a message is about, so it is said only once.
 */
export interface BotMessage {
  text: string;
  buttons: ChatButton[];
  link: ChatLink | null;
  attachments: Attachment[];
  kind: ChatKind;
  refId: string | null;
}

const MAX_ATTACHMENTS = 2;

const taskLink = (id: string): ChatLink => ({ type: "task", id });
const sentence = (s: string): string => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** The button that does a task, by its kind. */
function doButton(task: { id: string; kind: TaskKind }): ChatButton {
  if (task.kind === "get") {
    return { label: "Got it", action: { type: "task_state", taskId: task.id, state: "done" } };
  }
  // Doing the work and writing a message both start by opening the task's kit.
  const label = task.kind === "do" ? "Start" : "Send";
  return { label, action: { type: "open", link: taskLink(task.id) } };
}

export function requestArrived(
  request: { id: string; understood: string; openQuestion: OpenQuestion | null },
  attachments: Attachment[],
): BotMessage {
  const question = request.openQuestion;
  const buttons: ChatButton[] = question
    ? question.options.slice(0, MAX_CHAT_BUTTONS).map((answer) => ({
        label: answer,
        action: { type: "answer_request", requestId: request.id, answer },
      }))
    : [
        { label: "Looks right", action: { type: "confirm_request", requestId: request.id } },
        { label: "Fix it", action: { type: "fix_request", requestId: request.id } },
      ];
  return {
    text: question ? `${request.understood}\n\n${question.text}` : request.understood,
    buttons,
    link: { type: "request", id: request.id },
    attachments: attachments.slice(0, MAX_ATTACHMENTS),
    kind: "request",
    refId: request.id,
  };
}

export function replyArrived(
  ask: { id: string; title: string } | null,
  understood: string,
  bundleId: string,
): BotMessage {
  return {
    text: understood,
    buttons: ask ? [{ label: "Close", action: { type: "close_ask", taskId: ask.id } }] : [],
    link: ask ? taskLink(ask.id) : null,
    attachments: [],
    kind: "reply",
    refId: bundleId,
  };
}

/**
 * `fireAt` is part of the identity: a snoozed or re-dated reminder is the same
 * row firing at a new time, and that must be said again (with fresh buttons).
 * A re-send of the same firing keeps the same identity and is not repeated.
 */
export function reminderDue(
  reminder: { id: string; fireAt: string },
  task: { id: string; kind: TaskKind; title: string },
  body: string,
): BotMessage {
  const buttons: ChatButton[] = [doButton(task)];
  if (task.kind === "do") {
    buttons.push({ label: "Done", action: { type: "task_state", taskId: task.id, state: "done" } });
  }
  buttons.push({ label: "Tomorrow", action: { type: "snooze", taskId: task.id, days: 1 } });
  return {
    text: `${sentence(task.title)} ${body}`,
    buttons,
    link: taskLink(task.id),
    attachments: [],
    kind: "reminder",
    refId: `${reminder.id}:${reminder.fireAt}`,
  };
}

export function taskUnblocked(task: { id: string; kind: TaskKind; title: string }): BotMessage {
  return {
    text: `${task.title.trim().replace(/[.!?]$/, "")} is ready.`,
    buttons: [doButton(task)],
    link: taskLink(task.id),
    attachments: [],
    kind: "unblocked",
    refId: task.id,
  };
}

/** `weekKey` is the local date the review was sent, so there is one per week. */
export function weeklyReview(count: number, weekKey: string): BotMessage {
  return {
    text: `${count} ${count === 1 ? "thing" : "things"} on the back burner.`,
    buttons: [
      { label: "Review", action: { type: "open", link: { type: "upnext" } } },
      { label: "Skip", action: { type: "dismiss" } },
    ],
    link: { type: "upnext" },
    attachments: [],
    kind: "review",
    refId: weekKey,
  };
}

/** `dayKey` is the local date, so this is said at most once a day. */
export function pushNotWorking(dayKey: string): BotMessage {
  return {
    text: "Reminders are not reaching your phone.",
    buttons: [{ label: "Fix", action: { type: "open", link: { type: "setup" } } }],
    link: { type: "setup" },
    attachments: [],
    kind: "health",
    refId: dayKey,
  };
}

export function ruleLearned(rule: { id: string; sentence: string }): BotMessage {
  return {
    text: `Learned: ${rule.sentence}`,
    buttons: [{ label: "Undo", action: { type: "undo_rule", ruleId: rule.id } }],
    link: null,
    attachments: [],
    kind: "rule",
    refId: rule.id,
  };
}

/** A plain line saying what the bot just did on the user's behalf. */
export function didAction(text: string): BotMessage {
  return {
    text: sentence(text),
    buttons: [],
    link: null,
    attachments: [],
    kind: "did",
    refId: null,
  };
}

// ── Check-ins and progress photos (1b) ───────────────────────────────────

/** A button label is at most two words: a long project name is cut to its first two. */
const shortName = (name: string): string => name.trim().split(/\s+/).slice(0, 2).join(" ");

interface NamedProject {
  id: string;
  name: string;
}

const focusButtons = (projects: NamedProject[]): ChatButton[] =>
  projects.slice(0, MAX_CHAT_BUTTONS).map((p) => ({
    label: shortName(p.name),
    action: { type: "set_focus", projectId: p.id },
  }));

/**
 * A check-in during working hours. Keyed on the day and its place in it
 * (`ordinal`: which mid-day check-in this is), so two runs in the same window
 * say it once.
 */
export function checkIn(
  kind: "start" | "during" | "end",
  ctx: { date: string; ordinal: number; focus: NamedProject | null; projects: NamedProject[] },
): BotMessage {
  const base = { link: null, attachments: [], kind: "checkin" as const };
  if (kind === "end") {
    return {
      ...base,
      text: "Photo of where you got to?",
      buttons: [
        { label: "Add photo", action: { type: "open", link: { type: "camera" } } },
        { label: "Skip", action: { type: "dismiss" } },
      ],
      refId: `${ctx.date}:end`,
    };
  }
  const refId = kind === "start" ? `${ctx.date}:start` : `${ctx.date}:during:${ctx.ordinal}`;
  if (kind === "during" && ctx.focus) {
    const focus = ctx.focus;
    // "Yes" keeps the focus; any other project changes it. There is no way to
    // answer "no" that leaves the old focus quietly in place, because a photo
    // would then be filed under it without a word.
    return {
      ...base,
      text: `Still on ${focus.name}?`,
      buttons: [
        { label: "Yes", action: { type: "set_focus", projectId: focus.id } },
        ...focusButtons(ctx.projects.filter((p) => p.id !== focus.id)).slice(
          0,
          MAX_CHAT_BUTTONS - 1,
        ),
      ],
      refId,
    };
  }
  return {
    ...base,
    text: kind === "start" ? "What are you on today?" : "What are you on?",
    buttons: focusButtons(ctx.projects),
    refId,
  };
}

/** Fairly sure: filed, and here is where, with the other projects as a way to move it. */
export function progressFiled(
  entry: { id: string },
  project: NamedProject,
  projects: NamedProject[],
): BotMessage {
  return {
    text: `Filed under ${project.name}.`,
    buttons: projects
      .filter((p) => p.id !== project.id)
      .slice(0, MAX_CHAT_BUTTONS - 1)
      .map((p) => ({
        label: shortName(p.name),
        action: { type: "file_progress", entryId: entry.id, projectId: p.id },
      })),
    link: { type: "project", id: project.id },
    attachments: [],
    kind: "progress",
    refId: entry.id,
  };
}

/** Unsure: ask once, do not guess. */
export function progressAsk(entry: { id: string }, projects: NamedProject[]): BotMessage {
  return {
    text: "Which project is this photo for?",
    buttons: projects.slice(0, MAX_CHAT_BUTTONS).map((p) => ({
      label: shortName(p.name),
      action: { type: "file_progress", entryId: entry.id, projectId: p.id },
    })),
    link: null,
    attachments: [],
    kind: "progress",
    refId: entry.id,
  };
}
