import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
  BatchItem,
  CoachBatch,
  CoachRequest,
  CoachTask,
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

  tool(
    "list_batches",
    "List a project's batches. A batch is a set of finished work the owner checks item by item and then reports to the client in one message.",
    { project: z.string().describe("Project name or id") },
    async ({ project }) => {
      const found = await findProject(project);
      const { batches } = await api<{ batches: CoachBatch[] }>(
        "GET",
        `/batches?projectId=${encodeURIComponent(found.id)}`,
      );
      return batches.map((b) => ({
        id: b.id,
        status: b.status,
        items: b.itemCount,
        unchecked: b.uncheckedCount,
        createdAt: b.createdAt,
        sentAt: b.sentAt,
      }));
    },
  );

  tool(
    "get_batch",
    "Read one batch: each item with whether it was checked off or carried over (and why), and the summary written for the client, if there is one yet.",
    { id: z.string().describe("Batch id from list_batches") },
    async ({ id }) => {
      const { batch, items } = await api<{ batch: CoachBatch; items: BatchItem[] }>(
        "GET",
        `/batches/${encodeURIComponent(id)}`,
      );
      const all = await projects();
      return {
        id: batch.id,
        project: all.find((p) => p.id === batch.projectId)?.name ?? null,
        status: batch.status,
        summary: batch.summary,
        sentAt: batch.sentAt,
        items: items.map((i) => ({
          label: i.label,
          state: i.state,
          note: i.note,
          requestId: i.requestId,
          taskId: i.taskId,
        })),
      };
    },
  );

  return server;
}
