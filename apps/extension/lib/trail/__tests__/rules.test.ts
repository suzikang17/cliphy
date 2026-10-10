import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { MIN_OPEN_MS, shouldTrail } from "../rules";

const NOW = new Date("2026-10-10T15:00:00").getTime();
const at = (url: string, openedAt?: number) =>
  shouldTrail({ url, title: "t", openedAt, closedAt: NOW });

describe("shouldTrail", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — trail");
  });

  it.each([
    "https://linear.app/acme/issue/ENG-1",
    "http://example.com/",
    "https://www.youtube.com/watch?v=abc",
    "https://docs.google.com/document/d/1/edit?q=x", // ?q= only counts on search engines
    "https://maps.google.com/?q=coffee",
    "https://github.com/search-ui/lib", // "search" inside a path word
    "https://lessons.com/course", // "sso" inside a host word
    "https://example.com/blog/how-to-login-faster-tips", // not a login path word on its own
    "https://example.com/authors/jane",
  ])("keeps %s", (url) => {
    expect(at(url)).toBe(true);
  });

  it.each([
    ["chrome://newtab/", "browser page"],
    ["chrome-extension://abc/newtab.html", "extension page"],
    ["about:blank", "about page"],
    ["file:///Users/me/a.pdf", "local file"],
    ["not a url", "unparsable"],
    ["https://www.google.com/_/chrome/newtab?ie=UTF-8", "Google new tab"],
  ])("skips %s (%s)", (url) => {
    expect(at(url)).toBe(false);
  });

  it.each([
    "https://www.google.com/search?q=cliphy",
    "https://google.co.uk/search?q=cliphy",
    "https://www.google.com/?q=cliphy",
    "https://www.bing.com/search?q=cliphy",
    "https://duckduckgo.com/?q=cliphy",
    "https://html.duckduckgo.com/html/?q=cliphy",
    "https://search.yahoo.com/search?p=cliphy",
    "https://www.ecosia.org/search?method=index&q=cliphy",
    "https://www.startpage.com/sp/search?query=cliphy",
    "https://www.startpage.com/do/search?query=cliphy",
  ])("skips search results: %s", (url) => {
    expect(at(url)).toBe(false);
  });

  it.each([
    "https://accounts.google.com/v3/signin/identifier",
    "https://login.microsoftonline.com/common/oauth2/authorize",
    "https://sso.acme.com/start",
    "https://auth.example.com/",
    "https://github.com/login",
    "https://github.com/login/oauth/authorize?client_id=x",
    "https://example.com/users/sign_in",
    "https://example.com/sign-in",
    "https://example.com/signin.php",
    "https://example.com/account/signup",
    "https://example.com/logout",
    "https://example.com/oauth/authorize",
    "https://app.example.com/api/auth/callback/google",
    "https://example.com/sso/saml",
  ])("skips auth pages: %s", (url) => {
    expect(at(url)).toBe(false);
  });

  it("skips tabs open less than 10 seconds when the open time is known", () => {
    const url = "https://example.com/article";
    expect(at(url, NOW - (MIN_OPEN_MS - 1))).toBe(false);
    expect(at(url, NOW - MIN_OPEN_MS)).toBe(true);
    expect(at(url, undefined)).toBe(true); // unknown open time: keep
  });
});
