import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
  BatchItem,
  CoachBatch,
  CoachRequest,
  CoachTask,
  Digest,
  InboundMessage,
  Person,
  Project,
  UpNext,
} from "@cliphy/shared";

// The coach as tools for an outside assistant (Claude Code and the like):
// see what is open on a project, read what the client asked, add work, mark
// it done. Each tool is a thin wrapper over the coach API, so the rules live
// in one place: the routes.

/** One call to the coach API as the signed-in owner. `path` is under /api/coach. */
export type CoachCall = (
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
) => Promise<{ status: number; body: unknown }>;

class ToolError extends Error {}

const say = (data: unknown): CallToolResult => ({
  content: [
    { type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) },
  ],
});

const TASK_STATES = ["open", "waiting", "done", "dropped"] as const;
const REQUEST_STATUSES = ["new", "confirmed", "replaced", "closed"] as const;

export function buildCoachMcp(call: CoachCall): McpServer {
  const server = new McpServer({ name: "cliphy", version: "1.0.0" });

  /** Read or write, turning a refusal into the reason the server gave. */
  async function api<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await call(method, path, body);
    if (res.status >= 200 && res.status < 300) return res.body as T;
    const reason = (res.body as { error?: unknown } | null)?.error;
    throw new ToolError(typeof reason === "string" ? reason : `Cliphy answered ${res.status}`);
  }

  const projects = async () => (await api<{ projects: Project[] }>("GET", "/projects")).projects;

  /** A project given as its id or its name, in any case. */
  async function findProject(wanted: string, all?: Project[]): Promise<Project> {
    const list = all ?? (await projects());
    const key = wanted.trim().toLowerCase();
    const found =
      list.find((p) => p.id === wanted) ?? list.find((p) => p.name.toLowerCase() === key);
    if (found) return found;
    const names = list.map((p) => p.name).join(", ");
    throw new ToolError(`No project called "${wanted}". Projects: ${names || "none yet"}.`);
  }

  const taskLine = (task: CoachTask, all: Project[]) => ({
    id: task.id,
    title: task.title,
    kind: task.kind,
    state: task.state,
    blocked: task.blocked,
    dueDate: task.dueDate,
    project: all.find((p) => p.id === task.projectId)?.name ?? null,
    requestId: task.requestId,
  });

  const messageLine = (message: InboundMessage) => ({
    from: message.direction === "out" ? "me" : "client",
    sentAt: message.sentAt,
    text: message.text,
    images: message.attachments.map((a) => a.url).filter((url): url is string => Boolean(url)),
  });

  /** Register a tool whose failures come back as a plain sentence, not a crash. */
  function tool<Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: Shape,
    run: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>,
  ): void {
    server.registerTool(name, { description, inputSchema }, (async (args: unknown) => {
      try {
        return say(await run(args as z.infer<z.ZodObject<Shape>>));
      } catch (err) {
        if (err instanceof ToolError) return { ...say(err.message), isError: true };
        throw err;
      }
    }) as never);
  }

  tool(
    "list_projects",
    "List the owner's client projects: the client, where the project stands, how many tasks are open and the next one. Start here to find a project's name.",
    {},
    async () => {
      const [all, people, up] = await Promise.all([
        projects(),
        api<{ people: Person[] }>("GET", "/people"),
        api<Pick<UpNext, "byProject">>("GET", "/upnext"),
      ]);
      return all.map((p) => {
        const work = up.byProject.find((b) => b.projectId === p.id);
        return {
          id: p.id,
          name: p.name,
          client: people.people.find((person) => p.personIds.includes(person.id))?.name ?? null,
          active: p.active,
          state: p.stateLine || null,
          openTasks: work?.open ?? 0,
          next: work?.next ?? null,
        };
      });
    },
  );

  tool(
    "list_tasks",
    "List tasks. Without a state it gives work still to do (open, and waiting on someone). Give a project name or id to see one project only. Kinds: do (work), tell (report to the client), ask (a question for them), get (something to obtain).",
    {
      project: z.string().optional().describe("Project name or id"),
      state: z.enum(TASK_STATES).optional().describe("Only tasks in this state"),
    },
    async ({ project, state }) => {
      const all = await projects();
      const query = new URLSearchParams();
      if (state) query.set("state", state);
      if (project) query.set("projectId", (await findProject(project, all)).id);
      const suffix = query.size > 0 ? `?${query}` : "";
      const { tasks } = await api<{ tasks: CoachTask[] }>("GET", `/tasks${suffix}`);
      return tasks.map((t) => taskLine(t, all));
    },
  );

  tool(
    "get_task",
    "Read one task in full: what the client asked for, the owner's answer to any question, and the client's own messages with links to their pictures. Read this before doing the work.",
    { id: z.string().describe("Task id from list_tasks") },
    async ({ id }) => {
      const { task } = await api<{ task: CoachTask }>("GET", `/tasks/${encodeURIComponent(id)}`);
      const [all, behind, pulled] = await Promise.all([
        projects(),
        task.requestId
          ? api<{ request: CoachRequest; messages: InboundMessage[] }>(
              "GET",
              `/requests/${encodeURIComponent(task.requestId)}`,
            )
          : null,
        api<{ messages: InboundMessage[] }>("GET", `/tasks/${encodeURIComponent(id)}/messages`),
      ]);
      return {
        task: taskLine(task, all),
        asked: behind?.request.understood ?? null,
        answer: behind?.request.answer ?? null,
        messages: [...(behind?.messages ?? []), ...pulled.messages].map(messageLine),
      };
    },
  );

  tool(
    "find_requests",
    "Read a client's recent text messages and pull out every distinct thing they asked for: grouped by what it concerns, each with the detail needed to do it and the client's own words, exactly as sent. Use this to see what a client wants done before starting work. Reads the last 7 days unless told otherwise.",
    {
      person: z.string().describe("The client's name or id"),
      days: z.number().int().min(1).max(365).optional().describe("How many days back. Default 7."),
    },
    async ({ person, days }) => {
      const [{ people }, all] = await Promise.all([
        api<{ people: Person[] }>("GET", "/people"),
        projects(),
      ]);
      const key = person.trim().toLowerCase();
      const found =
        people.find((p) => p.id === person) ?? people.find((p) => p.name.toLowerCase() === key);
      if (!found) {
        const names = people.map((p) => p.name).join(", ");
        throw new ToolError(`Nobody called "${person}". People: ${names || "none yet"}.`);
      }
      const digest = await api<Digest>("POST", `/people/${encodeURIComponent(found.id)}/digest`, {
        days: days ?? 7,
      });
      return {
        person: found.name,
        days: digest.days,
        textsRead: digest.messageCount,
        groups: digest.groups.map((group) => ({
          name: group.name,
          requests: group.items.map((item) => ({
            title: item.title,
            detail: item.detail,
            theirWords: item.quotes.map((quote) => ({
              sentAt: quote.sentAt,
              text: quote.text,
              images: quote.attachments
                .map((a) => a.url)
                .filter((url): url is string => Boolean(url)),
            })),
            project: all.find((p) => p.id === item.projectId)?.name ?? null,
            dueDate: item.dueDate,
            taskId: item.taskId,
            answered: item.answered,
          })),
        })),
      };
    },
  );

  tool(
    "list_requests",
    "List what clients have asked for. Without a status it gives requests still in play (new or confirmed). A new request may carry a question the owner has not answered yet.",
    {
      project: z.string().optional().describe("Project name or id"),
      status: z.enum(REQUEST_STATUSES).optional().describe("Only requests with this status"),
    },
    async ({ project, status }) => {
      const all = await projects();
      const only = project ? await findProject(project, all) : null;
      const { requests } = await api<{ requests: CoachRequest[] }>(
        "GET",
        `/requests${status ? `?status=${status}` : ""}`,
      );
      return requests
        .filter(
          (r) => status || ((r.status === "new" || r.status === "confirmed") && !r.historical),
        )
        .filter((r) => !only || r.projectId === only.id)
        .map((r) => ({
          id: r.id,
          asked: r.understood,
          status: r.status,
          question: r.openQuestion?.text ?? null,
          answer: r.answer,
          dueDate: r.dueDate,
          project: all.find((p) => p.id === r.projectId)?.name ?? null,
          createdAt: r.createdAt,
        }));
    },
  );

  tool(
    "add_task",
    "Add a task to a project by hand, for work that did not come from a client's message. It shows on the owner's phone under Up next and can go into a batch once done.",
    {
      project: z.string().describe("Project name or id"),
      title: z.string().describe("What needs doing, in a few words"),
      kind: z.enum(["do", "tell", "ask", "get"]).optional().describe("Defaults to do"),
      dueDate: z.string().optional().describe("YYYY-MM-DD"),
    },
    async ({ project, title, kind, dueDate }) => {
      const all = await projects();
      const { task } = await api<{ task: CoachTask }>("POST", "/tasks", {
        kind: kind ?? "do",
        title,
        projectId: (await findProject(project, all)).id,
        ...(dueDate ? { dueDate } : {}),
      });
      return taskLine(task, all);
    },
  );

  tool(
    "set_task_state",
    "Mark a task done once the work is finished and checked, drop it, or reopen it. Done work is what the owner later reports to the client in a batch, so only mark done what is really done.",
    {
      id: z.string().describe("Task id"),
      state: z.enum(["done", "open", "dropped"]),
    },
    async ({ id, state }) => {
      const { task } = await api<{ task: CoachTask }>("PATCH", `/tasks/${encodeURIComponent(id)}`, {
        state,
      });
      return taskLine(task, await projects());
    },
  );

  /** A client given as their id or their name, in any case. */
  async function findPerson(wanted: string, people?: Person[]): Promise<Person> {
    const list = people ?? (await api<{ people: Person[] }>("GET", "/people")).people;
    const key = wanted.trim().toLowerCase();
    const found =
      list.find((p) => p.id === wanted) ?? list.find((p) => p.name.toLowerCase() === key);
    if (found) return found;
    const names = list.map((p) => p.name).join(", ");
    throw new ToolError(`Nobody called "${wanted}". People: ${names || "none yet"}.`);
  }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** A batch given as its id, or as a client's name: their newest batch not yet sent. */
  async function findBatch(wanted: string): Promise<string> {
    if (UUID.test(wanted.trim())) return wanted.trim();
    const person = await findPerson(wanted);
    const { batches } = await api<{ batches: CoachBatch[] }>(
      "GET",
      `/batches?personId=${encodeURIComponent(person.id)}`,
    );
    const open = batches.find((b) => b.status !== "sent");
    if (!open) {
      throw new ToolError(
        `${person.name} has no batch waiting. Make one on the phone or in the Mac window: Texts → ${person.name} → select their messages → Batch.`,
      );
    }
    return open.id;
  }

  const batchLine = (b: CoachBatch) => ({
    id: b.id,
    status: b.status,
    items: b.itemCount,
    unchecked: b.uncheckedCount,
    createdAt: b.createdAt,
    sentAt: b.sentAt,
  });

  tool(
    "list_batches",
    "List batches for a project or a client, newest first. A batch is a set of things a client asked for that the owner works through item by item and then reports on in one message.",
    {
      project: z.string().optional().describe("Project name or id"),
      client: z.string().optional().describe("Client's name or id"),
    },
    async ({ project, client }) => {
      if (!project && !client) throw new ToolError("Give a project or a client.");
      const query = new URLSearchParams();
      if (project) query.set("projectId", (await findProject(project)).id);
      if (client) query.set("personId", (await findPerson(client)).id);
      const { batches } = await api<{ batches: CoachBatch[] }>("GET", `/batches?${query}`);
      return batches.map(batchLine);
    },
  );

  tool(
    "get_batch",
    "Read one batch: every item with the client's own words (and links to their pictures), whether it has been addressed and how, the summary for the client if there is one, what in the batch is not addressed yet, and the client's other open requests that are in no batch. Give a batch id, or a client's name for their newest batch not yet sent.",
    { batch: z.string().describe("Batch id, or the client's name") },
    async ({ batch: wanted }) => {
      const id = await findBatch(wanted);
      const { batch, items } = await api<{ batch: CoachBatch; items: BatchItem[] }>(
        "GET",
        `/batches/${encodeURIComponent(id)}`,
      );
      const [all, { people }, candidates] = await Promise.all([
        projects(),
        api<{ people: Person[] }>("GET", "/people"),
        api<{ requests: CoachRequest[] }>(
          "GET",
          `/batches/candidates?personId=${encodeURIComponent(batch.personId)}`,
        ),
      ]);
      const inBatch = new Set(items.map((i) => i.requestId).filter(Boolean));
      return {
        id: batch.id,
        client: people.find((p) => p.id === batch.personId)?.name ?? null,
        project: all.find((p) => p.id === batch.projectId)?.name ?? null,
        status: batch.status,
        summary: batch.summary,
        sentAt: batch.sentAt,
        items: items.map((i) => ({
          id: i.id,
          asked: i.label,
          kind: i.requestId ? "request" : i.taskId ? "task" : "message",
          state: i.state,
          note: i.note,
          requestId: i.requestId,
          taskId: i.taskId,
          theirWords: (i.messages ?? []).map(messageLine),
        })),
        notAddressed: items
          .filter((i) => i.state !== "done")
          .map((i) => ({ id: i.id, asked: i.label, state: i.state, note: i.note })),
        stillOpen: candidates.requests
          .filter((r) => (r.status === "new" || r.status === "confirmed") && !r.historical)
          .filter((r) => !inBatch.has(r.id))
          .map((r) => ({
            requestId: r.id,
            asked: r.understood,
            status: r.status,
            project: all.find((p) => p.id === r.projectId)?.name ?? null,
            createdAt: r.createdAt,
          })),
      };
    },
  );

  tool(
    "check_batch_item",
    "Record how one batch item was dealt with. done: the change is made; the note says what changed, in a line the owner can check. not_done: it is carried over to a later batch; the note says why (blocked, needs the owner, needs the client). Every item needs one of these before the summary can be saved.",
    {
      batch: z.string().describe("Batch id"),
      item: z.string().describe("Item id from get_batch"),
      state: z.enum(["done", "not_done"]),
      note: z.string().min(1).describe("What changed, or why it was not done"),
    },
    async ({ batch, item, state, note }) => {
      const { item: saved } = await api<{ item: BatchItem }>(
        "PATCH",
        `/batches/${encodeURIComponent(batch)}/items/${encodeURIComponent(item)}`,
        { state, note },
      );
      return { id: saved.id, asked: saved.label, state: saved.state, note: saved.note };
    },
  );

  tool(
    "save_batch_summary",
    "Save the message for the client about this batch, once every item is checked. It shows on the owner's phone and in the Mac window, ready for her to send; nothing is sent to the client from here.",
    {
      batch: z.string().describe("Batch id"),
      summary: z.string().min(1).describe("The message, in the format the owner asked for"),
    },
    async ({ batch, summary }) => {
      const { batch: saved } = await api<{ batch: CoachBatch }>(
        "PATCH",
        `/batches/${encodeURIComponent(batch)}`,
        { summary },
      );
      return { id: saved.id, status: saved.status, summary: saved.summary };
    },
  );

  server.registerPrompt(
    "work_batch",
    {
      description:
        "Work through a client's batch in this repo: address each request, record what changed, write the summary for the client, and list what is still not done.",
      argsSchema: {
        batch: z.string().describe("Batch id, or the client's name for their newest batch"),
        format: z
          .string()
          .optional()
          .describe("How to write the summary, e.g. 'bullets', 'a short text', 'email'"),
      },
    },
    ({ batch, format }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: workBatchPrompt(batch, format) },
        },
      ],
    }),
  );

  return server;
}

/** The steps Claude Code follows for `/mcp__cliphy__work_batch`. */
export function workBatchPrompt(batch: string, format?: string): string {
  const how = format?.trim()
    ? format.trim()
    : "a short, friendly text message in my voice, one line per request, saying what changed";
  return [
    `Work through my Cliphy batch "${batch}" in this repository.`,
    "",
    `1. Call get_batch with batch "${batch}". Read every item, including the client's own words and pictures (theirWords).`,
    "2. For each item, make the change in this repo that addresses it. If it cannot be done here, or needs me or the client to decide, do not guess: leave it for step 3 as not done.",
    "3. After each item, call check_batch_item: state done with a note saying what you changed (where, and what is different now), or not_done with a note saying why.",
    `4. When every item is checked, write the summary for the client of the changes that addressed each request, as: ${how}. Only report what was really done. Save it with save_batch_summary and show it to me. Do not send anything to the client; I send it.`,
    "5. Then call get_batch again and list what has not been addressed: the batch's notAddressed items (with why), and the client's stillOpen requests that are not in this batch.",
  ].join("\n");
}
