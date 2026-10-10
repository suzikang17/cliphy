import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { siteGroups } from "../siteGroups";
import { hostOf } from "../types";

describe("siteGroups", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View");
  });

  it("groups tabs by host with www. stripped", () => {
    const groups = siteGroups([
      { url: "https://www.github.com/a" },
      { url: "https://github.com/b" },
      { url: "https://linear.app/acme/issue/1" },
    ]);
    expect(groups.map((g) => [g.host, g.tabs.length])).toEqual([
      ["github.com", 2],
      ["linear.app", 1],
    ]);
  });

  it("keeps subdomains other than www distinct", () => {
    const groups = siteGroups([
      { url: "https://docs.google.com/x" },
      { url: "https://mail.google.com/y" },
    ]);
    expect(groups.map((g) => g.host)).toEqual(["docs.google.com", "mail.google.com"]);
  });

  it("drops non-http(s) tabs", () => {
    const groups = siteGroups([
      { url: "chrome://extensions" },
      { url: "chrome-extension://abc/newtab.html" },
      { url: "file:///Users/me/a.pdf" },
      { url: "about:blank" },
      { url: "http://example.com" },
    ]);
    expect(groups.map((g) => g.host)).toEqual(["example.com"]);
  });

  it("preserves input order of tabs within a group", () => {
    const a = { url: "https://x.com/1", id: 1 };
    const b = { url: "https://x.com/2", id: 2 };
    expect(siteGroups([b, a])[0].tabs).toEqual([b, a]);
  });

  it("hostOf returns empty string for unparsable URLs", () => {
    expect(hostOf("not a url")).toBe("");
    expect(hostOf("https://WWW.Example.com/p")).toBe("example.com");
  });
});
