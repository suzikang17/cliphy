import type { ReminderKind, TaskKind } from "@cliphy/shared";

/**
 * The words of a reminder. Copy rule: keep who asked, what for and by when;
 * cut everything else. The title is the task; the body is one short sentence.
 */
export function reminderText(input: {
  kind: ReminderKind;
  title: string;
  taskKind: TaskKind;
  personName: string | null;
  /** True when the task came from someone's request (so "asked for" is true). */
  fromRequest: boolean;
  dueTime: string | null;
}): { title: string; body: string } {
  const time = input.dueTime ? input.dueTime.slice(0, 5) : null;
  const when =
    input.kind === "day_before" ? "tomorrow" : input.kind === "at_time" && time ? time : "today";

  if (input.personName && input.fromRequest) {
    return { title: input.title, body: `${input.personName} asked for this by ${when}.` };
  }
  const due = input.kind === "at_time" && time ? `Due at ${time}.` : `Due ${when}.`;
  return { title: input.title, body: due };
}
