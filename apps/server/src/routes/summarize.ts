import { Hono } from "hono";
import { fetchTranscript, TranscriptNotAvailableError } from "../services/transcript.js";
import { summarizeTranscript } from "../services/summarizer.js";

export const summarizeRoutes = new Hono();

summarizeRoutes.post("/", async (c) => {
  const body = await c.req.json<{ videoId: string; videoTitle?: string }>();

  if (!body.videoId) {
    return c.json({ error: "videoId is required" }, 400);
  }

  try {
    const transcript = await fetchTranscript(body.videoId);
    const result = await summarizeTranscript(transcript, body.videoTitle ?? "Untitled Video");
    return c.json(result);
  } catch (error) {
    if (error instanceof TranscriptNotAvailableError) {
      return c.json({ error: error.message }, 422);
    }
    console.error("Summarize error:", error);
    return c.json({ error: "Failed to generate summary" }, 500);
  }
});
