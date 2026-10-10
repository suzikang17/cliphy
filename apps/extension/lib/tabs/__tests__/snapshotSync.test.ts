import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";

const api = vi.hoisted(() => ({ closeGroupSnapshot: vi.fn(), resumeGroup: vi.fn() }));
vi.mock("../../api", () => api);
const auth = vi.hoisted(() => ({ isAuthenticated: vi.fn() }));
vi.mock("../../auth", () => auth);

const { pushSnapshots } = await import("../snapshotSync");

const snap = {
  key: "tag:a",
  label: "a",
  pages: [{ url: "https://a.com/", title: "A" }],
  updatedAt: 1,
};

describe("pushSnapshots", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — durable groups");
    vi.clearAllMocks();
    auth.isAuthenticated.mockResolvedValue(true);
    api.closeGroupSnapshot.mockResolvedValue({ closedAt: "t" });
    api.resumeGroup.mockResolvedValue({ pages: [] });
  });

  it("sends changed groups and deletes removed ones", async () => {
    const failed = await pushSnapshots({ "tag:a": snap }, ["tag:a", "tag:gone"]);
    expect(api.closeGroupSnapshot).toHaveBeenCalledWith("tag:a", "a", snap.pages);
    expect(api.resumeGroup).toHaveBeenCalledWith("tag:gone");
    expect(failed).toEqual([]);
  });

  it("reports groups the server didn't get; signed out sends nothing", async () => {
    api.closeGroupSnapshot.mockRejectedValue(new Error("offline"));
    expect(await pushSnapshots({ "tag:a": snap }, ["tag:a"])).toEqual(["tag:a"]);
    auth.isAuthenticated.mockResolvedValue(false);
    api.closeGroupSnapshot.mockClear();
    expect(await pushSnapshots({ "tag:a": snap }, ["tag:a"])).toEqual(["tag:a"]);
    expect(api.closeGroupSnapshot).not.toHaveBeenCalled();
  });
});
