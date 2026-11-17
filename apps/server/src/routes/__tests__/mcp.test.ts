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
    expect(tools).toHaveLength(8);

    const result = await client.callTool({ name: "list_projects", arguments: {} });
    const text = (result.content as { text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual([expect.objectContaining({ name: "Alder House" })]);
    await client.close();
  });
});
