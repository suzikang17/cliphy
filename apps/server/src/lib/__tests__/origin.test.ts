import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { originAllowed } from "../origin.js";

// Which callers the API answers, judged by the Origin header a browser adds.
// A browser adds it to every write, even one to the page's own site.

describe("originAllowed", () => {
  beforeEach(async () => {
    await layer("unit");
    await epic("Security");
    await feature("CORS");
  });

  const allowed = ["https://listed.example"];

  it("answers a request with no Origin (a server, the phone app, a plain page load)", () => {
    expect(originAllowed(undefined, "cliphy.app", allowed)).toBe(true);
  });

  it("answers the site's own pages writing to their own address", () => {
    expect(originAllowed("https://cliphy.app", "cliphy.app", allowed)).toBe(true);
    expect(originAllowed("http://localhost:3001", "localhost:3001", allowed)).toBe(true);
  });

  it("answers a listed origin and a browser extension", () => {
    expect(originAllowed("https://listed.example", "cliphy.app", allowed)).toBe(true);
    expect(originAllowed("chrome-extension://abc", "cliphy.app", allowed)).toBe(true);
    expect(originAllowed("moz-extension://abc", "cliphy.app", allowed)).toBe(true);
  });

  it("refuses any other site, including a look-alike of this one", () => {
    expect(originAllowed("https://evil.example", "cliphy.app", allowed)).toBe(false);
    expect(originAllowed("https://cliphy.app.evil.example", "cliphy.app", allowed)).toBe(false);
    expect(originAllowed("https://evil.example/cliphy.app", "cliphy.app", allowed)).toBe(false);
    expect(originAllowed("null", "cliphy.app", allowed)).toBe(false);
    expect(originAllowed("not a url", "cliphy.app", allowed)).toBe(false);
  });

  it("refuses its own name when the address the request came to is unknown", () => {
    expect(originAllowed("https://cliphy.app", undefined, allowed)).toBe(false);
  });

  it("answers everyone when no list is set (local development)", () => {
    expect(originAllowed("https://anything.example", "localhost:3001", [])).toBe(true);
  });
});
