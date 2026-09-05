import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { toSummary, toClip } from "../mappers.js";

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

const tweetRow = {
  id: "clip-1",
  user_id: "user-1",
  youtube_video_id: null,
  source_type: "tweet",
  source_url: "https://x.com/user/status/123",
  content: "Hello world",
  author: "@user",
  published_at: "2026-06-29T10:00:00Z",
  source_metadata: { tweetId: "123" },
  video_title: null,
  video_url: null,
  video_channel: null,
  video_duration_seconds: null,
  status: "completed",
  summary_json: null,
  error_message: null,
  tags: [],
  created_at: "2026-06-29T10:00:00Z",
  updated_at: "2026-06-29T10:00:00Z",
};

describe("toClip", () => {
  beforeEach(() => {
    layer("unit");
    epic("Data");
    feature("DB Mapping");
  });

  it("maps tweet row to Clip with sourceType and content", () => {
    const clip = toClip(tweetRow);

    expect(clip.id).toBe("clip-1");
    expect(clip.sourceType).toBe("tweet");
    expect(clip.sourceUrl).toBe("https://x.com/user/status/123");
    expect(clip.content).toBe("Hello world");
    expect(clip.author).toBe("@user");
    expect(clip.publishedAt).toBe("2026-06-29T10:00:00Z");
    expect(clip.sourceMetadata).toEqual({ tweetId: "123" });
    expect(clip.videoId).toBeUndefined();
    expect(clip.summaryJson).toBeUndefined();
    expect(clip.status).toBe("completed");
  });

  it("maps web clip columns (category, hero_image_url, excerpt)", () => {
    const row = {
      id: "c1",
      user_id: "u1",
      source_type: "web",
      source_url: "https://example.com/post",
      status: "completed",
      category: "reading",
      hero_image_url: "https://example.com/hero.jpg",
      excerpt: "A short preview.",
      tags: [],
      created_at: "2026-09-05T00:00:00Z",
      updated_at: "2026-09-05T00:00:00Z",
    };
    const clip = toClip(row);
    expect(clip.sourceType).toBe("web");
    expect(clip.category).toBe("reading");
    expect(clip.heroImageUrl).toBe("https://example.com/hero.jpg");
    expect(clip.excerpt).toBe("A short preview.");
  });

  it("maps YouTube row preserving existing fields", () => {
    const ytRow = {
      ...tweetRow,
      youtube_video_id: "dQw4w9WgXcQ",
      source_type: "youtube",
      source_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
      content: null,
      author: "Test Channel",
      video_title: "Test Video",
      video_url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
      video_channel: "Test Channel",
      video_duration_seconds: 120,
    };
    const clip = toClip(ytRow);

    expect(clip.sourceType).toBe("youtube");
    expect(clip.videoId).toBe("dQw4w9WgXcQ");
    expect(clip.videoTitle).toBe("Test Video");
    expect(clip.videoChannel).toBe("Test Channel");
    expect(clip.videoDurationSeconds).toBe(120);
  });
});
