import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { clock, pickAudioType, voiceStatus } from "../voiceNote";

describe("voice notes", () => {
  beforeEach(async () => {
    await layer("unit");
    await epic("Library");
    await feature("Voice notes");
  });

  it("shows how long a recording has run as minutes and seconds", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(7.9)).toBe("0:07");
    expect(clock(65)).toBe("1:05");
    expect(clock(3600)).toBe("60:00");
  });

  it("records in the first kind of audio the browser can make", () => {
    // Safari makes mp4; Chrome and Firefox make webm.
    expect(pickAudioType((t) => t.startsWith("audio/mp4"))).toBe("audio/mp4");
    expect(pickAudioType((t) => t.includes("webm"))).toBe("audio/webm;codecs=opus");
    expect(pickAudioType(() => false)).toBeNull();
  });

  it("says where a voice note is: being read, failed with the reason, or ready", () => {
    expect(voiceStatus({ status: "processing" })).toBe("Transcribing");
    expect(
      voiceStatus({ status: "failed", errorMessage: "No speech found in the recording" }),
    ).toBe("No speech found in the recording");
    expect(voiceStatus({ status: "failed" })).toBe("Error");
    expect(voiceStatus({ status: "completed" })).toBeNull();
  });
});
