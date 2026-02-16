import { Hono } from "hono";

export const summaryRoutes = new Hono();

summaryRoutes.get("/", async (c) => {
  // TODO: List summaries for user
  return c.json({ summaries: [] });
});

summaryRoutes.get("/:id", async (c) => {
  // TODO: Get specific summary
  const id = c.req.param("id");
  return c.json({ summary: { id } });
});
