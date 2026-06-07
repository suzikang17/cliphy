import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, __resetRateLimit } from "../rateLimit.js";

describe("checkRateLimit", () => {
  beforeEach(() => {
    __resetRateLimit();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("allows up to the limit then blocks", () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit("k", 3, 1000)).toBe(true);
    expect(checkRateLimit("k", 3, 1000)).toBe(false);
  });

  it("resets after the window", () => {
    expect(checkRateLimit("k", 1, 1000)).toBe(true);
    expect(checkRateLimit("k", 1, 1000)).toBe(false);
    vi.setSystemTime(1001);
    expect(checkRateLimit("k", 1, 1000)).toBe(true);
  });

  it("tracks keys independently", () => {
    expect(checkRateLimit("a", 1, 1000)).toBe(true);
    expect(checkRateLimit("b", 1, 1000)).toBe(true);
  });
});
