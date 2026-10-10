// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { extractPage, isSkipped, type ExtractedPage } from "../extractPage";

function setPage(html: string, head = "") {
  document.head.innerHTML = head;
  document.body.innerHTML = html;
  document.title = "Doc"; // set after head is replaced
}

function setScroll({ scrollY, innerHeight, scrollHeight }: Record<string, number>) {
  Object.defineProperty(window, "scrollY", { value: scrollY, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: innerHeight, configurable: true });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
}

describe("extractPage", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View");
    setScroll({ scrollY: 0, innerHeight: 800, scrollHeight: 4000 });
  });

  it("prefers <article> over main and body, and reads title + meta description", () => {
    setPage(
      `<nav>Nav junk</nav><main>Main text<article>Article   body\n\n text</article></main>`,
      `<meta name="description" content="  A page about things ">`,
    );
    const r = extractPage() as ExtractedPage;
    expect(r.text).toBe("Article body text");
    expect(r.description).toBe("A page about things");
    expect(r.title).toBe("Doc");
  });

  it("falls back main → [role=main] → body", () => {
    setPage(`<nav>Nav</nav><main>Main only</main>`);
    expect((extractPage() as ExtractedPage).text).toBe("Main only");

    setPage(`<nav>Nav</nav><div role="main">Role main</div>`);
    expect((extractPage() as ExtractedPage).text).toBe("Role main");

    setPage(`<div>Just   the body</div>`);
    expect((extractPage() as ExtractedPage).text).toBe("Just the body");
  });

  it("trims text to 2,000 chars after collapsing whitespace", () => {
    setPage(`<article>${"word   ".repeat(1000)}</article>`);
    const r = extractPage() as ExtractedPage;
    expect(r.text).toHaveLength(2000);
    expect(r.text).not.toMatch(/\s{2}/);
    expect(r.text.startsWith("word word")).toBe(true);
  });

  it("skips pages with a password field", () => {
    setPage(`<form><input type="password"></form><article>Secret</article>`);
    const r = extractPage();
    expect(r).toEqual({ skipped: "sensitive" });
    expect(isSkipped(r)).toBe(true);
  });

  it("reports scrolledToEnd at ≥ 90% of scroll height", () => {
    setPage(`<article>x</article>`);
    setScroll({ scrollY: 0, innerHeight: 800, scrollHeight: 4000 });
    expect((extractPage() as ExtractedPage).scrolledToEnd).toBe(false);

    setScroll({ scrollY: 2800, innerHeight: 800, scrollHeight: 4000 }); // 3600 = 90%
    expect((extractPage() as ExtractedPage).scrolledToEnd).toBe(true);
  });

  it("does not report scrolledToEnd for short pages that fit on screen", () => {
    // A dashboard or short issue is trivially "at the bottom" — that's not "read".
    setPage(`<main>short</main>`);
    setScroll({ scrollY: 0, innerHeight: 800, scrollHeight: 900 });
    expect((extractPage() as ExtractedPage).scrolledToEnd).toBe(false);
  });

  it("is self-contained (no module references when serialized)", () => {
    // executeScript serializes `func`; a reference to an import or module
    // constant would be undefined in the page.
    const src = extractPage.toString();
    expect(src).not.toMatch(/EXTRACT_TEXT_LIMIT|isSkipped|import/);
  });
});
