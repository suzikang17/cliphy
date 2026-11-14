import type { CoachTask, Person, Project, UpNext, UpNextTask } from "@cliphy/shared";
import { addDays } from "./time.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BACK_BURNER_TITLES = 3;
const NO_PLACE = "Anywhere";

const dayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
const shortDate = (date: string): string => {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

/** How to name a date relative to today: "today", a weekday within the week, else "18 Nov". */
function nameDate(date: string, today: string): string {
  if (date === today) return "today";
  if (date > today && date <= addDays(today, 6)) return DAYS[dayOf(date)];
  return shortDate(date);
}

/**
 * Everything on the user's plate, arranged so only what matters is on top.
 * Pure: `today` is the user's local date.
 *
 * Copy rule for rows: a title plus at most one short detail, and the detail
 * says where the task came from ("Maren asked for Wednesday", "You set 09:00").
 */
export function buildUpNext(
  tasks: CoachTask[],
  people: Person[],
  projects: Project[],
  today: string,
  /** request id → the person who made the request. */
  requesters: Map<string, string> = new Map(),
): UpNext {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const weekEnd = addDays(today, 6);
  const live = tasks
    .filter((t) => t.state === "open" || t.state === "waiting")
    .sort(
      (a, b) =>
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99") ||
        a.createdAt.localeCompare(b.createdAt),
    );

  const row = (t: CoachTask): UpNextTask => {
    const person = t.withPersonId ? names.get(t.withPersonId) : undefined;
    // Who asked is whoever made the request, even when the task itself (work
    // the user does) is not "with" anyone.
    const requesterId = t.requestId ? requesters.get(t.requestId) : undefined;
    const requester = requesterId ? names.get(requesterId) : undefined;
    let detail: string;
    if (t.state === "waiting") detail = person ? `Waiting on ${person}` : "Waiting";
    else if (requester) {
      detail = t.dueDate
        ? `${requester} asked for ${nameDate(t.dueDate, today)}`
        : `${requester} asked`;
    } else if (t.dueTime) detail = `You set ${t.dueTime.slice(0, 5)}`;
    else detail = t.place?.trim() || "You set this";
    return {
      id: t.id,
      kind: t.kind,
      title: t.title,
      detail,
      dueDate: t.dueDate,
      blocked: t.blocked,
    };
  };

  const overdue: UpNextTask[] = [];
  const later: UpNextTask[] = [];
  const waiting: UpNextTask[] = [];
  const byDay = new Map<string, UpNextTask[]>();
  const byPlace = new Map<string, { place: string; tasks: UpNextTask[] }>();
  const backBurner: CoachTask[] = [];

  for (const t of live) {
    if (t.state === "waiting") waiting.push(row(t));
    else if (t.dueDate) {
      if (t.dueDate < today) overdue.push(row(t));
      else if (t.dueDate <= weekEnd)
        byDay.set(t.dueDate, [...(byDay.get(t.dueDate) ?? []), row(t)]);
      else later.push(row(t));
    } else if (t.kind === "get") {
      const place = t.place?.trim() || NO_PLACE;
      const key = place.toLowerCase();
      const group = byPlace.get(key) ?? { place, tasks: [] };
      group.tasks.push(row(t));
      byPlace.set(key, group);
    } else backBurner.push(t);
  }

  const thisWeek = [...byDay.entries()].map(([date, dayTasks]) => ({ date, tasks: dayTasks }));
  const errands = [...byPlace.values()].sort(
    (a, b) => Number(a.place === NO_PLACE) - Number(b.place === NO_PLACE),
  );

  // The strip names the next thing coming; failing that, the oldest overdue one.
  const nextUp = live.find(
    (t) => t.state === "open" && t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd,
  );
  let next: string | null = null;
  if (nextUp?.dueDate) {
    const day = DAYS[dayOf(nextUp.dueDate)].slice(0, 3);
    next = `${nextUp.title} · ${day}${nextUp.dueTime ? ` ${nextUp.dueTime.slice(0, 5)}` : ""}`;
  } else if (overdue[0]) {
    next = `${overdue[0].title} · overdue`;
  }

  const byProject = projects
    .filter((p) => p.active)
    .map((p) => {
      const mine = live.filter((t) => t.projectId === p.id);
      return {
        projectId: p.id,
        name: p.name,
        state: p.stateLine,
        next: mine.find((t) => t.state === "open" && !t.blocked)?.title ?? null,
        open: mine.length,
      };
    });

  return {
    strip: { thisWeek: overdue.length + thisWeek.reduce((n, d) => n + d.tasks.length, 0), next },
    overdue,
    thisWeek,
    later,
    waiting,
    errands,
    backBurner: {
      count: backBurner.length,
      titles: [...backBurner]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, BACK_BURNER_TITLES)
        .map((t) => t.title),
    },
    byProject,
  };
}
