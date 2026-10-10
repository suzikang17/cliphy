// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";

const { useTabSort, TAB_SORT_KEY } = await import("../useTabSort");

let local: Record<string, unknown> = {};

describe("useTabSort", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — sort");
    vi.clearAllMocks();
    local = {};
    browserMock.storage.local.get.mockImplementation(async (k: string) =>
      k in local ? { [k]: local[k] } : {},
    );
    browserMock.storage.local.set.mockImplementation(async (o: Record<string, unknown>) => {
      Object.assign(local, o);
    });
  });

  it("each group defaults to your order; a chosen sort is remembered per group", async () => {
    const { result } = renderHook(() => useTabSort());
    expect(result.current.sortFor("tag:a")).toBe("manual");
    await act(async () => result.current.setSort("tag:a", "name"));
    expect(result.current.sortFor("tag:a")).toBe("name");
    expect(result.current.sortFor("tag:b")).toBe("manual");
    expect(local[TAB_SORT_KEY]).toMatchObject({ sorts: { "tag:a": "name" } });
  });

  it("your order is saved per group and loads back", async () => {
    const first = renderHook(() => useTabSort());
    await act(async () =>
      first.result.current.setOrder("tag:a", ["https://x.com/2", "https://x.com/1"]),
    );
    const second = renderHook(() => useTabSort());
    await waitFor(() =>
      expect(second.result.current.orderFor("tag:a")).toEqual([
        "https://x.com/2",
        "https://x.com/1",
      ]),
    );
  });
});
