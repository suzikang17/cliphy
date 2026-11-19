import { describe, it, expect, vi, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { Hono } from "hono";
import { makeDb, type FakeDb, type Op } from "../coach/__tests__/helpers.js";

// The MCP endpoint end to end: a JSON-RPC call in, the coach's own routes
// answering underneath, with the caller's key carried through.

let db: FakeDb;
const seenKeys: (string | undefined)[] = [];
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));
vi.mock("../../lib/storage.js", () => ({ signImageUrl: vi.fn() }));
vi.mock("../../lib/inngest.js", () => ({ inngest: { send: vi.fn() } }));
vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: vi.fn(
    async (
      c: {
        req: { header: (n: string) => string | undefined };
        set: (k: string, v: string) => void;
        json: (b: unknown, s: number) => Response;
      },
      next: () => Promise<void>,
    ) => {
      const header = c.req.header("Authorization");
      seenKeys.push(header);
      if (header !== "Bearer cliphy_sk_good") return c.json({ error: "Unauthorized" }, 401);
      c.set("userId", "test-user-id");
      await next();
    },
  ),
}));
vi.mock("../../middleware/require-coach.js", () => ({
  requireCoach: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
}));

const { mcpRoutes } = await import("../mcp.js");
const app = () => new Hono().route("/api/mcp", mcpRoutes);

const rpc = (body: unknown, key: string | null = "cliphy_sk_good") =>
  app().request("/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
};

beforeEach(async () => {
  await layer("unit");
  await epic("Coach");
  await feature("MCP");
  seenKeys.length = 0;
  db = makeDb((op: Op) => {
    if (op.table === "coach_projects") {
      return {
        data: [
          {
            id: "p1",
            name: "Alder House",
            tag: "project:alder-house",
            active: true,
            state_line: "",
          },
        ],
      };
    }
    if (op.table === "coach_tasks") {
      return {
        data: [
          {
            id: "t1",
            kind: "do",
            state: "open",
            title: "Move the sconces up",
            project_id: "p1",
            kit: {},
            checklist: [],
            after_task_id: null,
            created_at: "2026-11-16T10:00:00Z",
          },
        ],
      };
    }
    return { data: [] };
  });
});

describe("POST /api/mcp", () => {
  it("answers the opening handshake", async () => {
    const res = await rpc(initialize);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe("cliphy");
  });

  it("lists the tools without a handshake first, as a serverless call must", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toContain("list_tasks");
  });

  it("runs a tool against the coach's own routes, as the caller", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_tasks", arguments: { project: "Alder House" } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    expect(body.result.isError).toBeFalsy();
    expect(JSON.parse(body.result.content[0].text)).toEqual([
      expect.objectContaining({ id: "t1", title: "Move the sconces up", project: "Alder House" }),
    ]);
    // The key is checked at the door and again on each inner call.
    expect(seenKeys.length).toBeGreaterThan(1);
    expect(new Set(seenKeys)).toEqual(new Set(["Bearer cliphy_sk_good"]));
  });

  it("refuses a call with no key or a wrong one", async () => {
    expect((await rpc(initialize, null)).status).toBe(401);
    expect((await rpc(initialize, "cliphy_sk_bad")).status).toBe(401);
  });
});

describe("other methods", () => {
  it("has no stream to open", async () => {
    const res = await app().request("/api/mcp", {
      headers: { Authorization: "Bearer cliphy_sk_good", Accept: "text/event-stream" },
    });
    expect(res.status).toBe(405);
  });
});

describe("a real MCP client", () => {
  it("connects, lists the tools and calls one", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } =
      await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const transport = new StreamableHTTPClientTransport(new URL("http://cliphy.test/api/mcp"), {
      requestInit: { headers: { Authorization: "Bearer cliphy_sk_good" } },
      // Straight into the app: no network.
      fetch: async (input, init) => app().request(String(input), init),
    });
    const client = new Client({ name: "test", version: "1" });
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(11);

    const result = await client.callTool({ name: "list_projects", arguments: {} });
    const text = (result.content as { text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual([expect.objectContaining({ name: "Alder House" })]);
    await client.close();
  });
});

describe("working a batch from Claude Code, end to end", () => {
  const BATCH = "5d1c2b3a-0000-4000-8000-00000000ba01";
  let items: Record<string, unknown>[];
  let batch: Record<string, unknown>;

  beforeEach(() => {
    batch = {
      id: BATCH,
      user_id: "test-user-id",
      person_id: "lotus",
      project_id: "p1",
      status: "checking",
      summary: null,
      sent_at: null,
      created_at: "2026-11-18T10:00:00Z",
    };
    items = [
      {
        id: "i1",
        batch_id: BATCH,
        request_id: null,
        message_id: "m1",
        task_id: null,
        label: "make the menu sticky",
        state: "unchecked",
        note: null,
        position: 0,
      },
      {
        id: "i2",
        batch_id: BATCH,
        request_id: null,
        message_id: "m2",
        task_id: null,
        label: "new photo on the about page",
        state: "unchecked",
        note: null,
        position: 1,
      },
    ];
    const message = (id: string, text: string) => ({
      id,
      person_id: "lotus",
      direction: "in",
      text,
      attachments: [],
      sent_at: "2026-11-18T09:00:00Z",
      bundle_id: null,
    });
    db = makeDb((op: Op) => {
      if (op.table === "coach_people") {
        return { data: [{ id: "lotus", name: "Lotus", role: "client", handles: [] }] };
      }
      if (op.table === "coach_projects") {
        return { data: [{ id: "p1", name: "Lotus Yoga", tag: "project:lotus", active: true }] };
      }
      if (op.table === "coach_batches") {
        if (op.action === "update") {
          Object.assign(batch, op.payload);
          return { data: batch };
        }
        return { data: op.single ? batch : [batch] };
      }
      if (op.table === "coach_batch_items") {
        if (op.action === "update") {
          const id = op.filters.find(([, col]) => col === "id")?.[2];
          const row = items.find((i) => i.id === id);
          Object.assign(row ?? {}, op.payload);
          return { data: row ?? null };
        }
        return { data: op.single ? (items[0] ?? null) : items };
      }
      if (op.table === "coach_messages") {
        return {
          data: [
            message("m1", "can the menu stay at the top when you scroll"),
            message("m2", "use the new photo on the about page"),
          ],
        };
      }
      if (op.table === "coach_requests") {
        return {
          data: [
            {
              id: "r5",
              person_id: "lotus",
              project_id: "p1",
              bundle_id: "b5",
              understood: "Add the spring class times",
              status: "confirmed",
              historical: false,
              created_at: "2026-11-17T10:00:00Z",
            },
          ],
        };
      }
      return { data: [] };
    });
  });

  async function connect() {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } =
      await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const transport = new StreamableHTTPClientTransport(new URL("http://cliphy.test/api/mcp"), {
      requestInit: { headers: { Authorization: "Bearer cliphy_sk_good" } },
      fetch: async (input, init) => app().request(String(input), init),
    });
    const client = new Client({ name: "test", version: "1" });
    await client.connect(transport);
    return client;
  }
  const read = (result: unknown) =>
    JSON.parse((result as { content: { text: string }[] }).content[0].text) as Record<
      string,
      unknown
    >;

  it("reads the batch by client name, ticks each item, saves the summary, and shows what is left", async () => {
    const client = await connect();

    const prompt = await client.getPrompt({
      name: "work_batch",
      arguments: { batch: "Lotus", format: "bullets" },
    });
    expect((prompt.messages[0].content as { text: string }).text).toContain("get_batch");

    const before = read(
      await client.callTool({ name: "get_batch", arguments: { batch: "lotus" } }),
    );
    expect(before.id).toBe(BATCH);
    expect(before.client).toBe("Lotus");
    expect((before.items as { asked: string }[]).map((i) => i.asked)).toEqual([
      "make the menu sticky",
      "new photo on the about page",
    ]);
    expect(before.stillOpen).toEqual([
      expect.objectContaining({ requestId: "r5", asked: "Add the spring class times" }),
    ]);

    // Saving before every item is checked is refused, by the route's own rule.
    const early = await client.callTool({
      name: "save_batch_summary",
      arguments: { batch: BATCH, summary: "x" },
    });
    expect(early.isError).toBe(true);

    await client.callTool({
      name: "check_batch_item",
      arguments: { batch: BATCH, item: "i1", state: "done", note: "Header is sticky (Nav.tsx)" },
    });
    await client.callTool({
      name: "check_batch_item",
      arguments: { batch: BATCH, item: "i2", state: "not_done", note: "Need the photo file" },
    });
    const saved = read(
      await client.callTool({
        name: "save_batch_summary",
        arguments: { batch: BATCH, summary: "- The menu now stays at the top" },
      }),
    );
    expect(saved).toEqual({
      id: BATCH,
      status: "ready",
      summary: "- The menu now stays at the top",
    });

    const after = read(await client.callTool({ name: "get_batch", arguments: { batch: BATCH } }));
    expect(after.notAddressed).toEqual([
      {
        id: "i2",
        asked: "new photo on the about page",
        state: "not_done",
        note: "Need the photo file",
      },
    ]);
    await client.close();
  });
});
