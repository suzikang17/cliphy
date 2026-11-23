import { describe, it, expect, vi, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";

const createSignedUrl = vi.fn();
vi.mock("../supabase.js", () => ({
  supabase: { storage: { from: () => ({ createSignedUrl }) } },
}));
const { resolveClipAudio } = await import("../storage.js");

describe("resolveClipAudio", () => {
  beforeEach(async () => {
    await layer("unit");
    await epic("Library");
    await feature("Voice notes");
    createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: "https://signed/a.m4a" } });
  });

  it("gives a voice note a short-lived address to play its recording from", async () => {
    const clip = await resolveClipAudio({
      sourceType: "voice",
      sourceMetadata: { storagePath: "voice/u1/a.m4a", seconds: 9 },
    });
    expect(clip.sourceMetadata).toEqual({
      storagePath: "voice/u1/a.m4a",
      seconds: 9,
      audioUrl: "https://signed/a.m4a",
    });
    expect(createSignedUrl).toHaveBeenCalledWith("voice/u1/a.m4a", 3600);
  });

  it("leaves other clips, and a voice note with no recording, as they are", async () => {
    const image = { sourceType: "image", sourceMetadata: { storagePath: "x.png" } };
    expect(await resolveClipAudio(image)).toEqual(image);
    expect(await resolveClipAudio({ sourceType: "voice" })).toEqual({ sourceType: "voice" });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
