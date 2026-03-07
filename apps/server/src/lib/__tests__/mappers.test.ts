import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { toSummary } from "../mappers.js";

const fullRow = {
  id: "sum-1",
  user_id: "user-1",
  youtube_video_id: "dQw4w9WgXcQ",
  video_title: "Test Video",
  video_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
  video_channel: "Test Channel",
  video_duration_seconds: 120,
  status: "completed",
  summary_json: { summary: "A summary", keyPoints: ["P1"] },
  error_message: null,
  tags: ["tag1", "tag2"],
  created_at: "2026-02-20T10:00:00Z",
  updated_at: "2026-02-20T10:00:00Z",
};

describe("toSummary", () => {
  beforeEach(() => {
    layer("unit");
    epic("Data");
    feature("DB Mapping");
  });

  it("maps snake_case DB row to camelCase Summary", () => {
    const summary = toSummary(fullRow);

    expect(summary.id).toBe("sum-1");
    expect(summary.userId).toBe("user-1");
    expect(summary.videoId).toBe("dQw4w9WgXcQ");
    expect(summary.videoTitle).toBe("Test Video");
    expect(summary.videoUrl).toBe("https://youtube.com/watch?v=dQw4w9WgXcQ");
    expect(summary.videoChannel).toBe("Test Channel");
    expect(summary.videoDurationSeconds).toBe(120);
    expect(summary.status).toBe("completed");
    expect(summary.summaryJson).toEqual({ summary: "A summary", keyPoints: ["P1"] });
    expect(summary.errorMessage).toBeUndefined();
    expect(summary.tags).toEqual(["tag1", "tag2"]);
    expect(summary.createdAt).toBe("2026-02-20T10:00:00Z");
  });

  it("handles null optional fields gracefully", () => {
    const minimalRow = {
      id: "sum-2",
      user_id: "user-1",
      youtube_video_id: "abc123",
      video_title: null,
      video_url: null,
      video_channel: null,
      video_duration_seconds: null,
      status: "pending",
      summary_json: null,
      error_message: null,
      tags: null,
      created_at: "2026-02-20T10:00:00Z",
      updated_at: "2026-02-20T10:00:00Z",
    };

    const summary = toSummary(minimalRow);

    expect(summary.videoTitle).toBeUndefined();
    expect(summary.videoUrl).toBeUndefined();
    expect(summary.videoChannel).toBeUndefined();
    expect(summary.videoDurationSeconds).toBeUndefined();
    expect(summary.summaryJson).toBeUndefined();
    expect(summary.errorMessage).toBeUndefined();
    expect(summary.tags).toEqual([]);
  });
});
