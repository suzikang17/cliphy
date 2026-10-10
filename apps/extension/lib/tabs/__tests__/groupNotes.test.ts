// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";

const api = vi.hoisted(() => ({ getGroupNotes: vi.fn(), putGroupNote: vi.fn() }));
vi.mock("../../api", () => api);

const { useGroupNotes } = await import("../groupNotes");

let local: Record<string, unknown> = {};

describe("useGroupNotes", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — group notes");
    vi.clearAllMocks();
    local = {};
    browserMock.storage.local.get.mockImplementation(async (k: string) =>
      k in local ? { [k]: local[k] } : {},
    );
    browserMock.storage.local.set.mockImplementation(async (o: Record<string, unknown>) => {
      Object.assign(local, o);
    });
    api.getGroupNotes.mockResolvedValue({ notes: { "client:acme": "invoice due Fri" } });
    api.putGroupNote.mockImplementation(async (tag: string, note: string) => ({ tag, note }));
  });

  it("loads your notes (cached copy first, then the server's)", async () => {
    local["tabs:groupNotes"] = { reading: "cached" };
    const { result } = renderHook(() => useGroupNotes(true));
    await waitFor(() => expect(result.current.notes).toEqual({ "client:acme": "invoice due Fri" }));
    expect(local["tabs:groupNotes"]).toEqual({ "client:acme": "invoice due Fri" });
  });

  it("save updates right away and stores it; an empty note removes it", async () => {
    const { result } = renderHook(() => useGroupNotes(true));
    await waitFor(() => expect(api.getGroupNotes).toHaveBeenCalled());
    await act(async () => {
      await result.current.save("design", "  ship v2 by Monday ");
    });
    expect(result.current.notes.design).toBe("ship v2 by Monday");
    expect(api.putGroupNote).toHaveBeenCalledWith("design", "ship v2 by Monday");
    await act(async () => {
      await result.current.save("design", "");
    });
    expect(result.current.notes.design).toBeUndefined();
  });

  it("a failed save puts the old note back and says so", async () => {
    api.putGroupNote.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useGroupNotes(true));
    await waitFor(() => expect(result.current.notes["client:acme"]).toBe("invoice due Fri"));
    await act(async () => {
      await result.current.save("client:acme", "changed");
    });
    expect(result.current.notes["client:acme"]).toBe("invoice due Fri");
    expect(result.current.error).toMatch(/Couldn.t save/);
  });
});
