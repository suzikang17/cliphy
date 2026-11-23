import { describe, it, expect } from "vitest";
import { clientOf } from "../clientKind.js";

describe("clientOf", () => {
  it.each([
    [{ origin: "chrome-extension://abcdefghijklmnop" }, "extension"],
    [{ origin: "moz-extension://1234" }, "extension"],
    [{ origin: "https://cliphy.app" }, "web"],
    [{ origin: "https://www.cliphy.app" }, "web"],
    [{ origin: "http://localhost:5173" }, "web"],
    [{ origin: "app://cliphy" }, "mac"],
    // A page that is not ours (a content script, or someone else's site).
    [{ origin: "https://www.youtube.com" }, "other"],
    [{ origin: "https://cliphy.app.evil.test" }, "other"],
    [{ userAgent: "Cliphy/42 CFNetwork/1568.100.1 Darwin/24.0.0" }, "ios"],
    [{ userAgent: "okhttp/4.12.0" }, "android"],
    [{ userAgent: "curl/8.5.0" }, "other"],
    [{}, "other"],
    // A browser's own user agent mentions neither; the Origin decides.
    [
      { origin: "https://cliphy.app", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" },
      "web",
    ],
  ])("%j → %s", (headers, kind) => {
    expect(clientOf(headers)).toBe(kind);
  });
});
