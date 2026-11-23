import { describe, it, expect, vi } from "vitest";
import { accountIdOf, createAnalytics, saveFailureReason } from "../analytics.js";

// What the extension reports, and under whose id.

const jwt = (payload: Record<string, unknown>) =>
  `${btoa(JSON.stringify({ alg: "ES256" }))}.${btoa(JSON.stringify(payload))}.sig`;

function setup(stored: Record<string, unknown> = {}, enabled = true) {
  const data = { ...stored };
  const send = vi.fn<(body: unknown) => Promise<undefined>>(async () => undefined);
  const analytics = createAnalytics({
    storage: {
      get: async (key) => (key in data ? { [key]: data[key] } : {}),
      set: async (items) => void Object.assign(data, items),
    },
    send,
    enabled,
    version: "1.2.3",
    newId: () => "install-1",
  });
  const bodies = () => send.mock.calls.map(([b]) => b as Record<string, unknown>);
  return { analytics, send, data, bodies };
}

describe("track", () => {
  it("reports under a random install id before anyone signs in, and keeps that id", async () => {
    const { analytics, bodies, data } = setup();
    await analytics.track("extension_installed");
    await analytics.track("sidepanel_opened");

    expect(bodies()).toEqual([
      expect.objectContaining({
        api_key: expect.stringMatching(/^phc_/),
        event: "extension_installed",
        distinct_id: "install-1",
        properties: { client: "extension", version: "1.2.3", $lib: "cliphy-extension" },
      }),
      expect.objectContaining({ event: "sidepanel_opened", distinct_id: "install-1" }),
    ]);
    expect(data.analyticsInstallId).toBe("install-1");
  });

  it("reports under the account id once signed in", async () => {
    const { analytics, bodies } = setup({ cliphy_access_token: jwt({ sub: "user-7" }) });
    await analytics.track("save_clicked", { source: "button" });
    expect(bodies()[0]).toMatchObject({
      distinct_id: "user-7",
      properties: expect.objectContaining({ source: "button" }),
    });
  });

  it("sends nothing in a development build", async () => {
    const { analytics, send } = setup({}, false);
    await analytics.track("save_clicked");
    await analytics.linkAccount();
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a failure to send", async () => {
    const { analytics, send } = setup();
    send.mockRejectedValue(new Error("offline"));
    await expect(analytics.track("save_clicked")).resolves.toBeUndefined();
  });
});

describe("linkAccount", () => {
  it("ties the install id to the account that just signed in", async () => {
    const { analytics, bodies } = setup({
      cliphy_access_token: jwt({ sub: "user-7" }),
      analyticsInstallId: "install-old",
    });
    await analytics.linkAccount();
    expect(bodies()).toEqual([
      expect.objectContaining({
        event: "$identify",
        distinct_id: "user-7",
        properties: expect.objectContaining({ $anon_distinct_id: "install-old" }),
      }),
    ]);
  });

  it("does nothing when nobody is signed in", async () => {
    const { analytics, send } = setup();
    await analytics.linkAccount();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("accountIdOf", () => {
  it("reads the account id, and gives null for anything that is not a token", () => {
    expect(accountIdOf(jwt({ sub: "user-7" }))).toBe("user-7");
    expect(accountIdOf(jwt({}))).toBeNull();
    expect(accountIdOf("nonsense")).toBeNull();
    expect(accountIdOf(undefined)).toBeNull();
  });
});

describe("saveFailureReason", () => {
  it.each([
    [
      Object.assign(new Error("Monthly summary limit reached"), { code: "rate_limited" }),
      "rate_limited",
    ],
    [Object.assign(new Error("Pro plan required"), { code: "pro_required" }), "pro_required"],
    [new Error("Video already queued"), "duplicate"],
    [new TypeError("Failed to fetch"), "network"],
    [new Error("Not authenticated"), "signed_out"],
    [new Error("Something odd about https://youtube.com/watch?v=abc"), "error"],
    ["a string", "error"],
  ])("%s → %s", (err, reason) => {
    expect(saveFailureReason(err)).toBe(reason);
  });
});
