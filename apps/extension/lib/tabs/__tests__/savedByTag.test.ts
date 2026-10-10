// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";

const api = vi.hoisted(() => ({ getSummaries: vi.fn() }));
vi.mock("../../api", () => api);

const { useSavedByTag, SAVED_BY_TAG_KEY, SAVED_PER_GROUP } = await import("../savedByTag");

let local: Record<string, unknown> = {};
const clip = (id: string, tags: string[]) => ({ id, tags, videoTitle: id, status: "completed" });

describe("useSavedByTag", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — saved in groups");
    vi.clearAllMocks();
    local = {};
    browserMock.storage.local.get.mockImplementation(async (k: string) =>
      k in local ? { [k]: local[k] } : {},
    );
    browserMock.storage.local.set.mockImplementation(async (o: Record<string, unknown>) => {
      Object.assign(local, o);
    });
    api.getSummaries.mockImplementation(async (tag: string) => ({
      summaries: tag === "design" ? [clip("c1", ["design"]), clip("c2", ["design"])] : [],
    }));
  });

  it("loads your saved clips for each tag group and remembers them", async () => {
    const { result } = renderHook(() => useSavedByTag(["design", "reading"], true));
    await waitFor(() => expect(result.current.design?.map((s) => s.id)).toEqual(["c1", "c2"]));
    expect(result.current.reading).toEqual([]);
    expect(api.getSummaries).toHaveBeenCalledWith("design", SAVED_PER_GROUP);
    expect((local[SAVED_BY_TAG_KEY] as Record<string, unknown>).design).toBeTruthy();
  });

  it("shows the remembered list first (instant), then the server's", async () => {
    local[SAVED_BY_TAG_KEY] = { design: [clip("old", ["design"])] };
    api.getSummaries.mockImplementation(() => new Promise(() => {})); // server slow
    const { result } = renderHook(() => useSavedByTag(["design"], true));
    await waitFor(() => expect(result.current.design?.map((s) => s.id)).toEqual(["old"]));
  });

  it("asks nothing while signed out", async () => {
    renderHook(() => useSavedByTag(["design"], false));
    await new Promise((r) => setTimeout(r, 10));
    expect(api.getSummaries).not.toHaveBeenCalled();
  });
});
