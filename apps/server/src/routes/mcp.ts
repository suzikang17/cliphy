import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AppEnv } from "../env.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireCoach } from "../middleware/require-coach.js";
import { buildCoachMcp, type CoachCall } from "../services/coach/mcp.js";
import { coachRoutes } from "./coach/index.js";

/**
 * The coach over MCP, for an outside assistant such as Claude Code:
 *
 *   claude mcp add --transport http cliphy https://api.cliphy.app/api/mcp \
 *     --header "Authorization: Bearer cliphy_sk_..."
 *
 * Each request stands alone (no session, a plain JSON answer), which is what a
 * serverless function can offer. The tools call the coach's own routes with
 * the caller's key, so they can do exactly what that key can and no more.
 */
export const mcpRoutes = new Hono<AppEnv>();

mcpRoutes.use("*", authMiddleware);
mcpRoutes.use("*", requireCoach);

mcpRoutes.post("/", async (c) => {
  const authorization = c.req.header("Authorization") ?? "";
  const call: CoachCall = async (method, path, body) => {
    const res = await coachRoutes.request(path, {
      method,
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await buildCoachMcp(call).connect(transport);
  return transport.handleRequest(c.req.raw);
});

// No stream to listen on and no session to end.
mcpRoutes.on(["GET", "DELETE"], "/", (c) =>
  c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, 405),
);
