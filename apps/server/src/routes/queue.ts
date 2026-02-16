import { Hono } from "hono";

export const queueRoutes = new Hono();

queueRoutes.get("/", async (c) => {
  // TODO: List queue items for user
  return c.json({ items: [] });
});

queueRoutes.post("/", async (c) => {
  // TODO: Add video to queue
  const body = await c.req.json();
  return c.json({ item: { videoUrl: body.videoUrl, status: "pending" } }, 201);
});

queueRoutes.get("/:id", async (c) => {
  // TODO: Get specific queue item
  const id = c.req.param("id");
  return c.json({ item: { id } });
});
