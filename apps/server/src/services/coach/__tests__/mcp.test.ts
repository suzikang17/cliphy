import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildCoachMcp, type CoachCall } from "../mcp.js";

// The tools an outside assistant (Claude Code and the like) gets. Each one is
// a thin wrapper over the coach API, reached through `call`.

type Call = { method: string; path: string; body?: unknown };
let calls: Call[];
let answers: Record<string, { status?: number; body: unknown }>;

const fakeCall: CoachCall = async (method, path, body) => {
  calls.push({ method, path, body });
  const found = answers[`${method} ${path}`];
  return found
    ? { status: found.status ?? 200, body: found.body }
    : { status: 404, body: { error: "not found" } };
};

async function client(): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildCoachMcp(fakeCall).connect(a);
  const c = new Client({ name: "test", version: "1" });
  await c.connect(b);
  return c;
}

/** Call a tool and return what it said, parsed, plus whether it was an error. */
async function run(name: string, args: Record<string, unknown> = {}) {
  const result = await (await client()).callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Plain words: an error or a short confirmation.
  }
  return { data, text, isError: Boolean(result.isError) };
}

const project = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Alder House",
  tag: "project:alder-house",
  active: true,
  stateLine: "Refreshing the home page",
  personIds: ["c1"],
  repo: null,
  siteUrl: null,
  ...over,
});

const task = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  requestId: "r1",
  projectId: "p1",
  kind: "do",
  state: "open",
  title: "Move the sconces up",
  blocked: false,
  dueDate: "2026-11-20",
  dueTime: null,
  createdAt: "2026-11-16T10:00:00Z",
  doneAt: null,
  ...over,
});

beforeEach(async () => {
  await layer("unit");
  await epic("Coach");
  await feature("MCP");
  calls = [];
  answers = {
    "GET /projects": {
      body: {
        projects: [
          project(),
          project({ id: "p2", name: "Birch Studio", personIds: [], stateLine: "" }),
        ],
      },
    },
    "GET /people": { body: { people: [{ id: "c1", name: "Maren" }] } },
    "GET /upnext": {
      body: {
        byProject: [
          { projectId: "p1", name: "Alder House", state: "", next: "Move the sconces up", open: 2 },
        ],
      },
    },
  };
});

describe("tool list", () => {
  it("offers the tools, each with a description", async () => {
    const { tools } = await (await client()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_task",
      "get_batch",
      "get_task",
      "list_batches",
      "list_projects",
      "list_requests",
      "list_tasks",
      "set_task_state",
    ]);
    for (const t of tools) expect(t.description?.length).toBeGreaterThan(20);
  });
});

describe("list_projects", () => {
  it("gives each project with its client, state and open work", async () => {
    const { data } = await run("list_projects");
    expect(data).toEqual([
      {
        id: "p1",
        name: "Alder House",
        client: "Maren",
        active: true,
        state: "Refreshing the home page",
        openTasks: 2,
        next: "Move the sconces up",
      },
      {
        id: "p2",
        name: "Birch Studio",
        client: null,
        active: true,
        state: null,
        openTasks: 0,
        next: null,
      },
    ]);
  });
});

describe("list_tasks", () => {
  it("lists open work for a project named in words", async () => {
    answers["GET /tasks?projectId=p1"] = { body: { tasks: [task()] } };
    const { data } = await run("list_tasks", { project: "alder house" });
    expect(data).toEqual([
      {
        id: "t1",
        title: "Move the sconces up",
        kind: "do",
        state: "open",
        blocked: false,
        dueDate: "2026-11-20",
        project: "Alder House",
        requestId: "r1",
      },
    ]);
  });

  it("passes a state on and works without a project", async () => {
    answers["GET /tasks?state=done"] = {
      body: { tasks: [task({ state: "done", projectId: null })] },
    };
    const { data } = await run("list_tasks", { state: "done" });
    expect((data as { project: string | null }[])[0].project).toBeNull();
  });

  it("says which projects exist when the name matches none", async () => {
    const { text, isError } = await run("list_tasks", { project: "Cedar" });
    expect(isError).toBe(true);
    expect(text).toContain("Alder House");
    expect(text).toContain("Birch Studio");
    expect(calls.some((c) => c.path.startsWith("/tasks"))).toBe(false);
  });
});

describe("get_task", () => {
  it("gives the task with what was asked and the client's own words", async () => {
    answers["GET /tasks/t1"] = { body: { task: task() } };
    answers["GET /requests/r1"] = {
      body: {
        request: { id: "r1", understood: "Move the sconces above the text", answer: "Layout" },
        messages: [
          {
            id: "m1",
            direction: "in",
            text: "can the sconces go above the text on page 2",
            sentAt: "2026-11-16T09:59:00Z",
            attachments: [
              { storagePath: "a.png", mediaType: "image/png", url: "https://signed/a.png" },
            ],
          },
        ],
        replaces: null,
      },
    };
    answers["GET /tasks/t1/messages"] = {
      body: {
        messages: [
          {
            id: "m2",
            direction: "out",
            text: "On it",
            sentAt: "2026-11-16T10:05:00Z",
            attachments: [],
          },
        ],
      },
    };
    const { data } = await run("get_task", { id: "t1" });
    expect(data).toEqual({
      task: {
        id: "t1",
        title: "Move the sconces up",
        kind: "do",
        state: "open",
        blocked: false,
        dueDate: "2026-11-20",
        project: "Alder House",
        requestId: "r1",
      },
      asked: "Move the sconces above the text",
      answer: "Layout",
      messages: [
        {
          from: "client",
          sentAt: "2026-11-16T09:59:00Z",
          text: "can the sconces go above the text on page 2",
          images: ["https://signed/a.png"],
        },
        { from: "me", sentAt: "2026-11-16T10:05:00Z", text: "On it", images: [] },
      ],
    });
  });

  it("works for a task added by hand, with no request behind it", async () => {
    answers["GET /tasks/t1"] = { body: { task: task({ requestId: null }) } };
    answers["GET /tasks/t1/messages"] = { body: { messages: [] } };
    const { data } = await run("get_task", { id: "t1" });
    expect(data).toMatchObject({ asked: null, answer: null, messages: [] });
    expect(calls.some((c) => c.path.startsWith("/requests"))).toBe(false);
  });

  it("reports a task that does not exist", async () => {
    answers["GET /tasks/nope"] = { status: 404, body: { error: "task not found" } };
    const { text, isError } = await run("get_task", { id: "nope" });
    expect(isError).toBe(true);
    expect(text).toContain("task not found");
  });
});

describe("list_requests", () => {
  const request = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    projectId: "p1",
    understood: "Move the sconces above the text",
    openQuestion: null,
    answer: null,
    status: "confirmed",
    dueDate: null,
    historical: false,
    createdAt: "2026-11-16T10:00:00Z",
    ...over,
  });

  it("lists requests still in play, leaving out replaced, closed and old history", async () => {
    answers["GET /requests"] = {
      body: {
        requests: [
          request(),
          request({
            id: "r2",
            status: "new",
            openQuestion: { text: "Content or layout?", options: ["Content", "Layout"] },
          }),
          request({ id: "r3", status: "replaced" }),
          request({ id: "r4", status: "closed" }),
          request({ id: "r5", historical: true }),
          request({ id: "r6", projectId: "p2" }),
        ],
      },
    };
    const { data } = await run("list_requests", { project: "Alder House" });
    expect((data as { id: string }[]).map((r) => r.id)).toEqual(["r1", "r2"]);
    expect((data as Record<string, unknown>[])[1]).toMatchObject({
      status: "new",
      question: "Content or layout?",
      project: "Alder House",
    });
  });

  it("asks for one status when given", async () => {
    answers["GET /requests?status=closed"] = {
      body: { requests: [request({ id: "r4", status: "closed" })] },
    };
    const { data } = await run("list_requests", { status: "closed" });
    expect((data as { id: string }[]).map((r) => r.id)).toEqual(["r4"]);
  });
});

describe("add_task", () => {
  it("adds a thing to do on the project", async () => {
    answers["POST /tasks"] = {
      status: 201,
      body: { task: task({ id: "t9", requestId: null, title: "Fix the footer link" }) },
    };
    const { data } = await run("add_task", {
      project: "Alder House",
      title: "Fix the footer link",
      dueDate: "2026-11-21",
    });
    expect(calls.at(-1)).toEqual({
      method: "POST",
      path: "/tasks",
      body: { kind: "do", title: "Fix the footer link", projectId: "p1", dueDate: "2026-11-21" },
    });
    expect(data).toMatchObject({ id: "t9", title: "Fix the footer link", project: "Alder House" });
  });

  it("passes on why the server refused", async () => {
    answers["POST /tasks"] = { status: 400, body: { error: "title is required" } };
    const { text, isError } = await run("add_task", { project: "p1", title: " " });
    expect(isError).toBe(true);
    expect(text).toContain("title is required");
  });
});

describe("set_task_state", () => {
  it("marks a task done", async () => {
    answers["PATCH /tasks/t1"] = { body: { task: task({ state: "done" }) } };
    const { data } = await run("set_task_state", { id: "t1", state: "done" });
    expect(calls.at(-2)).toEqual({ method: "PATCH", path: "/tasks/t1", body: { state: "done" } });
    expect(data).toMatchObject({ id: "t1", state: "done" });
  });

  it("says so when the task is waiting on another", async () => {
    answers["PATCH /tasks/t1"] = { status: 409, body: { error: "task is blocked" } };
    const { text, isError } = await run("set_task_state", { id: "t1", state: "done" });
    expect(isError).toBe(true);
    expect(text).toContain("task is blocked");
  });
});

describe("batches", () => {
  const batch = {
    id: "b1",
    projectId: "p1",
    status: "ready",
    summary: "The changes are live.",
    sentAt: null,
    createdAt: "2026-11-17T10:00:00Z",
    itemCount: 2,
    uncheckedCount: 0,
  };

  it("lists a project's batches", async () => {
    answers["GET /batches?projectId=p1"] = { body: { batches: [batch] } };
    const { data } = await run("list_batches", { project: "Alder House" });
    expect(data).toEqual([
      {
        id: "b1",
        status: "ready",
        items: 2,
        unchecked: 0,
        createdAt: "2026-11-17T10:00:00Z",
        sentAt: null,
      },
    ]);
  });

  it("gives a batch's checklist and the summary for the client", async () => {
    answers["GET /batches/b1"] = {
      body: {
        batch,
        items: [
          {
            id: "i1",
            label: "Move the sconces up",
            state: "done",
            note: null,
            taskId: null,
            requestId: "r1",
            messages: [],
          },
          {
            id: "i2",
            label: "Swap the hero photo",
            state: "not_done",
            note: "Waiting on the photo",
            taskId: "t2",
            requestId: null,
            messages: [],
          },
        ],
      },
    };
    const { data } = await run("get_batch", { id: "b1" });
    expect(data).toEqual({
      id: "b1",
      project: "Alder House",
      status: "ready",
      summary: "The changes are live.",
      sentAt: null,
      items: [
        { label: "Move the sconces up", state: "done", note: null, requestId: "r1", taskId: null },
        {
          label: "Swap the hero photo",
          state: "not_done",
          note: "Waiting on the photo",
          requestId: null,
          taskId: "t2",
        },
      ],
    });
  });
});
