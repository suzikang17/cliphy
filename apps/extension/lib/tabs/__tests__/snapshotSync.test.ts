import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import "../../../test/browser-mock";
import { browserMock } from "../../../test/browser-mock";

const api = vi.hoisted(() => ({ closeGroupSnapshot: vi.fn(), resumeGroup: vi.fn() }));
vi.mock("../../api", () => api);
vi.mock("../../auth", () => ({ isAuthenticated: vi.fn().mockResolvedValue(true) }));

const { onPageClosed } = await import("../snapshotSync");

let local: Record<string, unknown> = {};
const snaps = () => local["tabs:groupSnapshots"] as Record<string, { pages: { url: string }[] }>;

describe("onPageClosed (background)", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Tabs View — durable groups");
    vi.clearAllMocks();
    local = {
      "tabs:groupSnapshots": {
        "tag:lotus": {
          key: "tag:lotus",
          label: "lotus",
          pages: [
            { url: "https://a.com/1", title: "1" },
            { url: "https://a.com/2", title: "2" },
          ],
          updatedAt: 1,
        },
      },
    };
    browserMock.storage.local.get.mockImplementation(async (k: string) =>
      k in local ? { [k]: local[k] } : {},
    );
    browserMock.storage.local.set.mockImplementation(async (o: Record<string, unknown>) => {
      Object.assign(local, o);
    });
    browserMock.tabs.query.mockResolvedValue([]);
    api.closeGroupSnapshot.mockResolvedValue({ closedAt: "t" });
  });

  it("drops the page from its group's snapshot and tells the server", async () => {
    await onPageClosed("https://a.com/1", 7);
    expect(snaps()["tag:lotus"].pages.map((p) => p.url)).toEqual(["https://a.com/2"]);
    expect(api.closeGroupSnapshot).toHaveBeenCalledWith("tag:lotus", "lotus", [
      { url: "https://a.com/2", title: "2" },
    ]);
  });

  it("keeps the page while another tab still shows it", async () => {
    browserMock.tabs.query.mockResolvedValue([{ id: 8, url: "https://www.a.com/1" }]);
    await onPageClosed("https://a.com/1", 7);
    expect(snaps()["tag:lotus"].pages).toHaveLength(2);
    expect(api.closeGroupSnapshot).not.toHaveBeenCalled();
  });

  it("deletes the server copy when the last page goes", async () => {
    await onPageClosed("https://a.com/1", 7);
    await onPageClosed("https://a.com/2", 8);
    expect(snaps()["tag:lotus"]).toBeUndefined();
    expect(api.resumeGroup).toHaveBeenCalledWith("tag:lotus");
  });
});
