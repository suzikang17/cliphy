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
      "check_batch_item",
      "find_requests",
      "get_batch",
      "get_task",
      "list_batches",
      "list_projects",
      "list_requests",
      "list_tasks",
      "save_batch_summary",
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
  const B1 = "0b7f6a52-1c1e-4d0b-9a57-3f2a1b6c9d01";
  const batch = {
    id: B1,
    personId: "c1",
    projectId: "p1",
    status: "checking",
    summary: null,
    sentAt: null,
    createdAt: "2026-11-17T10:00:00Z",
    itemCount: 2,
    uncheckedCount: 1,
  };
  const items = [
    {
      id: "i1",
      label: "Move the sconces up",
      state: "done",
      note: "Raised the sconce row 40px on /about",
      taskId: null,
      requestId: "r1",
      messageId: null,
      messages: [
        {
          id: "m1",
          direction: "in",
          sentAt: "2026-11-16T09:00:00Z",
          text: "can the lights go higher",
          attachments: [{ url: "https://x/pic.jpg" }],
        },
      ],
    },
    {
      id: "i2",
      label: "the hero photo is blurry",
      state: "unchecked",
      note: null,
      taskId: null,
      requestId: null,
      messageId: "m2",
      messages: [],
    },
  ];
  const request = (over: Record<string, unknown>) => ({
    id: "r9",
    understood: "Add opening hours to the footer",
    status: "confirmed",
    historical: false,
    projectId: "p1",
    createdAt: "2026-11-15T10:00:00Z",
    ...over,
  });

  beforeEach(() => {
    answers[`GET /batches/${B1}`] = { body: { batch, items } };
    answers["GET /batches?personId=c1"] = {
      body: { batches: [{ ...batch, id: "sent-one", status: "sent" }, batch] },
    };
    answers["GET /batches/candidates?personId=c1"] = {
      body: {
        requests: [
          request({}),
          request({ id: "r1" }), // already in this batch
          request({ id: "r8", status: "closed" }),
          request({ id: "r7", historical: true }),
        ],
      },
    };
  });

  it("lists a project's batches, or a client's", async () => {
    answers["GET /batches?projectId=p1"] = { body: { batches: [batch] } };
    const line = {
      id: B1,
      status: "checking",
      items: 2,
      unchecked: 1,
      createdAt: "2026-11-17T10:00:00Z",
      sentAt: null,
    };
    expect((await run("list_batches", { project: "Alder House" })).data).toEqual([line]);
    expect((await run("list_batches", { client: "maren" })).data).toHaveLength(2);
    expect((await run("list_batches", {})).isError).toBe(true);
  });

  it("gives each item with the client's words, what is not addressed, and what is open elsewhere", async () => {
    const { data } = await run("get_batch", { batch: B1 });
    expect(data).toEqual({
      id: B1,
      client: "Maren",
      project: "Alder House",
      status: "checking",
      summary: null,
      sentAt: null,
      items: [
        {
          id: "i1",
          asked: "Move the sconces up",
          kind: "request",
          state: "done",
          note: "Raised the sconce row 40px on /about",
          requestId: "r1",
          taskId: null,
          theirWords: [
            {
              from: "client",
              sentAt: "2026-11-16T09:00:00Z",
              text: "can the lights go higher",
              images: ["https://x/pic.jpg"],
            },
          ],
        },
        {
          id: "i2",
          asked: "the hero photo is blurry",
          kind: "message",
          state: "unchecked",
          note: null,
          requestId: null,
          taskId: null,
          theirWords: [],
        },
      ],
      notAddressed: [
        { id: "i2", asked: "the hero photo is blurry", state: "unchecked", note: null },
      ],
      stillOpen: [
        {
          requestId: "r9",
          asked: "Add opening hours to the footer",
          status: "confirmed",
          project: "Alder House",
          createdAt: "2026-11-15T10:00:00Z",
        },
      ],
    });
  });

  it("finds a client's newest batch not yet sent from their name", async () => {
    const { data } = await run("get_batch", { batch: "Maren" });
    expect((data as { id: string }).id).toBe(B1);
  });

  it("says how to make a batch when the client has none waiting", async () => {
    answers["GET /batches?personId=c1"] = { body: { batches: [] } };
    const { text, isError } = await run("get_batch", { batch: "Maren" });
    expect(isError).toBe(true);
    expect(text).toMatch(/Texts → Maren/);
  });

  it("records how an item was dealt with", async () => {
    answers[`PATCH /batches/${B1}/items/i2`] = {
      body: { item: { ...items[1], state: "not_done", note: "Need a sharper photo from her" } },
    };
    const { data } = await run("check_batch_item", {
      batch: B1,
      item: "i2",
      state: "not_done",
      note: "Need a sharper photo from her",
    });
    expect(calls.at(-1)).toEqual({
      method: "PATCH",
      path: `/batches/${B1}/items/i2`,
      body: { state: "not_done", note: "Need a sharper photo from her" },
    });
    expect(data).toMatchObject({ state: "not_done", note: "Need a sharper photo from her" });
  });

  it("saves the summary, and passes on a refusal while items are unchecked", async () => {
    answers[`PATCH /batches/${B1}`] = {
      body: { batch: { ...batch, status: "ready", summary: "Lights are higher now." } },
    };
    const { data } = await run("save_batch_summary", {
      batch: B1,
      summary: "Lights are higher now.",
    });
    expect(data).toEqual({ id: B1, status: "ready", summary: "Lights are higher now." });

    answers[`PATCH /batches/${B1}`] = { status: 409, body: { error: "Check every item first" } };
    const refused = await run("save_batch_summary", { batch: B1, summary: "x" });
    expect(refused).toMatchObject({ isError: true, text: "Check every item first" });
  });
});

describe("work_batch prompt", () => {
  it("walks Claude Code through the batch, in the format asked for", async () => {
    const c = await client();
    const { prompts } = await c.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["work_batch"]);
    const { messages } = await c.getPrompt({
      name: "work_batch",
      arguments: { batch: "Lotus", format: "bullets grouped by page" },
    });
    const text = (messages[0].content as { text: string }).text;
    for (const step of [
      "get_batch",
      "check_batch_item",
      "save_batch_summary",
      "notAddressed",
      "stillOpen",
    ]) {
      expect(text).toContain(step);
    }
    expect(text).toContain('"Lotus"');
    expect(text).toContain("bullets grouped by page");
  });

  it("falls back to a short text when no format is given", async () => {
    const { messages } = await (
      await client()
    ).getPrompt({
      name: "work_batch",
      arguments: { batch: "Lotus" },
    });
    expect((messages[0].content as { text: string }).text).toMatch(/short, friendly text/);
  });
});

describe("find_requests", () => {
  it("reads a person's recent texts into requests, each with their own words", async () => {
    answers["POST /people/c1/digest"] = {
      body: {
        days: 7,
        messageCount: 12,
        groups: [
          {
            name: "Front page",
            items: [
              {
                title: "Move the photo down",
                detail: "The front photo should sit further down.",
                quotes: [
                  {
                    messageId: "m1",
                    text: "Could the photo be further down",
                    sentAt: "2026-11-17T10:00:00Z",
                    attachments: [
                      { storagePath: "a.png", mediaType: "image/png", url: "https://signed/a.png" },
                    ],
                  },
                ],
                taskId: null,
                projectId: "p1",
                dueDate: "2026-11-21",
                answered: false,
              },
            ],
          },
        ],
      },
    };
    const { data } = await run("find_requests", { person: "maren", days: 7 });
    expect(calls.at(-1)).toEqual({ method: "POST", path: "/people/c1/digest", body: { days: 7 } });
    expect(data).toEqual({
      person: "Maren",
      days: 7,
      textsRead: 12,
      groups: [
        {
          name: "Front page",
          requests: [
            {
              title: "Move the photo down",
              detail: "The front photo should sit further down.",
              theirWords: [
                {
                  sentAt: "2026-11-17T10:00:00Z",
                  text: "Could the photo be further down",
                  images: ["https://signed/a.png"],
                },
              ],
              project: "Alder House",
              dueDate: "2026-11-21",
              taskId: null,
              answered: false,
            },
          ],
        },
      ],
    });
  });

  it("says who exists when the name matches nobody, and defaults to a week", async () => {
    const missing = await run("find_requests", { person: "Zed" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("Maren");
    answers["POST /people/c1/digest"] = { body: { days: 7, messageCount: 0, groups: [] } };
    await run("find_requests", { person: "c1" });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ days: 7 });
  });
});
