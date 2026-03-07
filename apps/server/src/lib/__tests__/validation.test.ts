import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { sanitizeSearchQuery } from "../validation.js";

describe("sanitizeSearchQuery", () => {
  beforeEach(() => {
    layer("unit");
    epic("Security");
    feature("Input Sanitization");
  });
  it("passes through normal text", () => {
    expect(sanitizeSearchQuery("react tutorial")).toBe("react tutorial");
  });

  it("strips commas and dots", () => {
    expect(sanitizeSearchQuery("hello, world.")).toBe("hello world");
  });

  it("strips parentheses and quotes", () => {
    expect(sanitizeSearchQuery('test("value")')).toBe("testvalue");
  });

  it("strips PostgREST wildcards: % and _", () => {
    expect(sanitizeSearchQuery("%admin%")).toBe("admin");
    expect(sanitizeSearchQuery("test_query")).toBe("testquery");
  });

  it("strips SQL/PostgREST special characters: * [ ] { } :", () => {
    expect(sanitizeSearchQuery("*")).toBe("");
    expect(sanitizeSearchQuery("[range]")).toBe("range");
    expect(sanitizeSearchQuery("{json}")).toBe("json");
    expect(sanitizeSearchQuery("key:value")).toBe("keyvalue");
  });

  it("strips backslashes", () => {
    expect(sanitizeSearchQuery("test\\injection")).toBe("testinjection");
  });

  it("trims whitespace", () => {
    expect(sanitizeSearchQuery("  hello  ")).toBe("hello");
  });

  it("enforces max length", () => {
    const long = "a".repeat(300);
    expect(sanitizeSearchQuery(long).length).toBe(200);
  });

  it("returns empty string for all-special-character input", () => {
    expect(sanitizeSearchQuery(".,()%_*")).toBe("");
  });
});
