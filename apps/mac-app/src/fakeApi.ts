// Made-up answers for the full app's API calls, so its screens can be drawn
// without a network or an account: in the CI pictures and in `preview`.
// Everything here is invented. The types keep it in step with the real API.
import type {
  CoachBatch,
  CoachChatMessage,
  CoachRequest,
  CoachTask,
  InboundMessage,
  Person,
  Project,
  UpNext,
  UpNextTask,
} from "../../../packages/shared/src/coach.js";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();
const date = (offset: number) => day(offset).slice(0, 10);

const person: Person = {
  id: "person-1",
  name: "Maren",
  role: "client",
  handles: ["+15550142"],
  captureThread: true,
  historyWindow: "new",
  historyDays: null,
};

const projects: Project[] = [
  {
    id: "project-1",
    name: "Alder House",
    tag: "project:alder-house",
    active: true,
    stateLine: "Refreshing the home page",
    personIds: ["person-1"],
    repo: null,
    siteUrl: null,
  },
  {
    id: "project-2",
    name: "Alder House shop",
    tag: "project:alder-house-shop",
    active: true,
    stateLine: "",
    personIds: ["person-1"],
    repo: null,
    siteUrl: null,
  },
];

const request: CoachRequest = {
  id: "request-1",
  bundleId: "bundle-1",
  projectId: "project-1",
  personId: "person-1",
  understood: "Move the sconces up on the lighting page",
  openQuestion: null,
  answer: null,
  status: "confirmed",
  replacesId: null,
  proposedReplacesId: null,
  proposedTasks: [],
  dueDate: date(2),
  historical: false,
  createdAt: day(-1),
  confirmedAt: day(-1),
};

const message = (
  over: Pick<CoachChatMessage, "id" | "role" | "kind" | "text" | "createdAt"> &
    Partial<CoachChatMessage>,
): CoachChatMessage => ({ attachments: [], buttons: [], link: null, chosen: null, ...over });

const chat: CoachChatMessage[] = [
  message({
    id: "chat-1",
    role: "bot",
    kind: "request",
    text: "Maren asked for a change on Alder House: move the sconces up on the lighting page. Is this content or layout?",
    buttons: [
      {
        label: "Content",
        action: { type: "answer_request", requestId: "request-1", answer: "Content" },
      },
      {
        label: "Layout",
        action: { type: "answer_request", requestId: "request-1", answer: "Layout" },
      },
    ],
    link: { type: "request", id: "request-1" },
    createdAt: day(-1),
  }),
  message({
    id: "chat-2",
    role: "user",
    kind: "user",
    text: "What's left on Alder House this week?",
    createdAt: day(-0.5),
  }),
  message({
    id: "chat-3",
    role: "bot",
    kind: "answer",
    text: "Two things: swap the hero photo, and tell Maren the lighting page is live.",
    link: { type: "upnext" },
    createdAt: day(-0.5),
  }),
];

const task = (id: string, title: string, detail: string, dueDate: string | null): UpNextTask => ({
  id,
  kind: "do",
  title,
  detail,
  dueDate,
  blocked: false,
});

const upnext: UpNext = {
  strip: { thisWeek: 2, next: "Swap the hero photo" },
  overdue: [],
  thisWeek: [
    {
      date: date(1),
      tasks: [task("task-1", "Swap the hero photo", "Maren · Alder House", date(1))],
    },
    {
      date: date(2),
      tasks: [task("task-2", "Tell Maren the lighting page is live", "Alder House", date(2))],
    },
  ],
  later: [],
  waiting: [],
  errands: [],
  backBurner: { count: 0, titles: [] },
  byProject: [
    {
      projectId: "project-1",
      name: "Alder House",
      state: "",
      next: "Swap the hero photo",
      open: 2,
    },
  ],
};

const batch: CoachBatch = {
  id: "batch-1",
  personId: "person-1",
  projectId: "project-1",
  status: "checking",
  summary: null,
  sentAt: null,
  createdAt: day(-0.2),
  itemCount: 3,
  uncheckedCount: 2,
};

const fullTask = (id: string, title: string, over: Partial<CoachTask> = {}): CoachTask => ({
  id,
  requestId: "request-1",
  projectId: "project-1",
  kind: "do",
  state: "open",
  title,
  kit: {},
  withPersonId: null,
  afterTaskId: null,
  blocked: false,
  dueDate: null,
  dueTime: null,
  place: null,
  checklist: [],
  replyBundleId: null,
  createdAt: day(-1),
  doneAt: null,
  ...over,
});

const tasks: CoachTask[] = [
  fullTask("task-1", "Swap the hero photo", { dueDate: date(1) }),
  fullTask("task-3", "Move the sconces up on the lighting page", { dueDate: date(-1) }),
  fullTask("task-2", "Tell Maren the lighting page is live", {
    kind: "tell",
    blocked: true,
    afterTaskId: "task-3",
  }),
  fullTask("task-4", "Ask Maren for the new price list", { kind: "ask", state: "waiting" }),
];

const text = (
  id: string,
  direction: "in" | "out",
  words: string,
  offset: number,
): InboundMessage => ({
  id,
  personId: "person-1",
  channel: "imessage",
  direction,
  text: words,
  attachments: [],
  sentAt: day(offset),
});

const texts: InboundMessage[] = [
  text("message-6", "in", "And the footer still says 2025", -0.2),
  text("message-5", "in", "Also can the hero photo be the one from the porch shoot", -0.4),
  text("message-4", "out", "Sconces are moved. Have a look when you can", -0.6),
  { ...text("message-3", "in", "Thank you!", -0.9), handledAt: day(-0.5) },
  text("message-2", "out", "Yes, I'll move them above the text today", -0.95),
  {
    ...text("message-1", "in", "Can we move the sconces up a little on the lighting page", -1),
    requestId: "request-1",
  },
  {
    ...text("message-0", "in", "Could the phone number be bigger on mobile", -3),
    batchId: "batch-1",
  },
];

const ROUTES: [RegExp, unknown][] = [
  [/^\/api\/coach\/chat$/, { messages: chat, activity: [] }],
  [/^\/api\/coach\/upnext$/, upnext],
  [/^\/api\/coach\/projects$/, { projects }],
  [/^\/api\/coach\/people$/, { people: [person] }],
  [
    /^\/api\/coach\/projects\/[^/]+\/history$/,
    { entries: [{ request, replaced: [] }], progress: [] },
  ],
  [/^\/api\/coach\/batches$/, { batches: [batch] }],
  [/^\/api\/coach\/batches\/candidates$/, { requests: [request], messages: [], tasks: [] }],
  [/^\/api\/coach\/tasks$/, { tasks }],
  [/^\/api\/coach\/people\/[^/]+\/messages$/, { messages: texts, hasMore: false }],
  [/^\/api\/coach\/rules$/, { rules: [] }],
  [/^\/api\/coach\/settings$/, { settings: { timezone: "America/New_York", timezoneSet: true } }],
  [
    /^\/api\/coach\/health$/,
    { pushTokens: 1, timezoneSet: true, pushOk: true, lastDeliveredAt: null, helperSeenAt: day(0) },
  ],
];

/** Stands in for Cliphy: answers reads with the data above and accepts every write. */
export async function fakeApi(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const found =
    request.method === "GET" ? ROUTES.find(([pattern]) => pattern.test(pathname)) : null;
  const body = found ? found[1] : request.method === "GET" ? null : { ok: true };
  return new Response(JSON.stringify(body ?? { error: "Not found" }), {
    status: body ? 200 : 404,
    headers: { "Content-Type": "application/json" },
  });
}
