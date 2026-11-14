import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { appleTimeToIso, textFromAttributedBody } from "../convert.js";
import { firstSync, toIntakeMessage } from "../plan.js";

/** A minimal typedstream body as Messages stores it: …NSString…, 0x01 0x2b, length, utf-8. */
function attributed(text: string): Buffer {
  const utf8 = Buffer.from(text, "utf8");
  const length =
    utf8.length < 0x80
      ? Buffer.from([utf8.length])
      : Buffer.from([0x81, utf8.length & 0xff, utf8.length >> 8]);
  return Buffer.concat([
    Buffer.from(
      "\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84",
      "latin1",
    ),
    Buffer.from([0x01, 0x2b]),
    length,
    utf8,
    Buffer.from("\x86\x84\x02iI\x01\x0b", "latin1"),
  ]);
}

describe("mac helper conversions", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Mac helper");
  });

  it("turns Apple's nanoseconds-since-2001 into an ISO time", () => {
    // 2026-11-14T17:42:00Z is 816370920 seconds after 2001-01-01.
    expect(appleTimeToIso(816370920_000_000_000)).toBe("2026-11-14T17:42:00.000Z");
  });

  it("also accepts the older seconds form", () => {
    expect(appleTimeToIso(816370920)).toBe("2026-11-14T17:42:00.000Z");
  });

  it("accepts the time as a bigint, which is how large values are read", () => {
    expect(appleTimeToIso(816370920_000_000_000n)).toBe("2026-11-14T17:42:00.000Z");
  });

  // Review Focus 2: no text column.
  it("recovers the words from an attributedBody when there is no text column", () => {
    expect(
      textFromAttributedBody(attributed("I like the writing on page 1 more than page 2")),
    ).toBe("I like the writing on page 1 more than page 2");
  });

  it("recovers long and non-ASCII text", () => {
    const long =
      "Set above the valley, Alder House takes a quieter approach — café, naïve, 日本語. ".repeat(
        4,
      );
    expect(textFromAttributedBody(attributed(long))).toBe(long);
  });

  it("returns an empty string for a body it cannot read", () => {
    expect(textFromAttributedBody(Buffer.from("not a typedstream"))).toBe("");
    expect(textFromAttributedBody(null)).toBe("");
  });

  it("starts from now for a person whose history choice is new messages only", () => {
    expect(
      firstSync({ historyWindow: "new", historyDays: null }, new Date("2026-11-14T18:00:00Z")),
    ).toEqual({
      mode: "skip",
    });
  });

  it("reads back a window of days", () => {
    expect(
      firstSync({ historyWindow: "window", historyDays: 90 }, new Date("2026-11-14T18:00:00Z")),
    ).toEqual({
      mode: "backfill",
      sinceIso: "2026-08-16T18:00:00.000Z",
    });
  });

  it("reads the whole thread when asked", () => {
    expect(
      firstSync({ historyWindow: "all", historyDays: null }, new Date("2026-11-14T18:00:00Z")),
    ).toEqual({
      mode: "backfill",
      sinceIso: null,
    });
  });

  it("builds the upload for one message, keyed on its Messages guid", () => {
    const row = {
      rowId: 41,
      guid: "ABC-123",
      text: "On it",
      sentAtIso: "2026-11-14T17:42:00.000Z",
      isFromMe: true,
      attachments: [],
    };
    expect(
      toIntakeMessage(row, [{ storagePath: "coach/u/a.jpg", mediaType: "image/jpeg" }]),
    ).toEqual({
      externalId: "ABC-123",
      direction: "out",
      text: "On it",
      sentAt: "2026-11-14T17:42:00.000Z",
      attachments: [{ storagePath: "coach/u/a.jpg", mediaType: "image/jpeg" }],
    });
    expect(toIntakeMessage({ ...row, isFromMe: false }, []).direction).toBe("in");
  });
});
