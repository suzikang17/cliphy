import { describe, it, expect, beforeEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { previewFromDeployments } from "../preview.js";

const BRANCH = "cliphy/3f9a1c2e-move-the-sconces-up";
const SHA = "a1b2c3d4";
const URL = "https://3f9a1c2e.alder-house.pages.dev";
const head = { branch: BRANCH, sha: SHA };
const statusesOf =
  (byId: Record<number, unknown>) =>
  async (id: number): Promise<unknown> =>
    byId[id] ?? [];

describe("finding the preview Cloudflare made for a branch", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Runner");
  });

  it("is the address of the branch's deployment once it has succeeded", async () => {
    const deployments = [
      { id: 9, ref: "main", sha: "zzz" },
      { id: 7, ref: BRANCH, sha: SHA },
    ];
    const statuses = statusesOf({
      7: [{ state: "success", environment_url: URL }, { state: "in_progress" }],
      9: [{ state: "success", environment_url: "https://alder-house.pages.dev" }],
    });
    expect(await previewFromDeployments(deployments, head, statuses)).toBe(URL);
  });

  it("finds a deployment recorded against the commit instead of the branch name", async () => {
    const statuses = statusesOf({ 7: [{ state: "success", environment_url: URL }] });
    expect(await previewFromDeployments([{ id: 7, ref: SHA, sha: SHA }], head, statuses)).toBe(URL);
  });

  it("is nothing while the newest deployment is still building", async () => {
    const statuses = statusesOf({ 7: [{ state: "in_progress" }] });
    expect(
      await previewFromDeployments([{ id: 7, ref: BRANCH, sha: SHA }], head, statuses),
    ).toBeNull();
  });

  it("is nothing when there is no deployment for the branch, or the list is not a list", async () => {
    const statuses = statusesOf({ 9: [{ state: "success", environment_url: URL }] });
    expect(
      await previewFromDeployments([{ id: 9, ref: "main", sha: "zzz" }], head, statuses),
    ).toBeNull();
    expect(await previewFromDeployments({ message: "Not Found" }, head, statuses)).toBeNull();
  });

  it("is nothing when the address is not https", async () => {
    const statuses = statusesOf({
      7: [{ state: "success", environment_url: "javascript:alert(1)" }],
    });
    expect(
      await previewFromDeployments([{ id: 7, ref: BRANCH, sha: SHA }], head, statuses),
    ).toBeNull();
  });
});
