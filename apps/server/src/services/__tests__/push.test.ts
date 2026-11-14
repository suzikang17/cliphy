import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { makeDb, eqValue, type FakeDb } from "../../routes/coach/__tests__/helpers.js";

let db: FakeDb;
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => db.from(t) } }));

const { sendPush } = await import("../push.js");

const fetchMock = vi.fn();
const message = {
  title: "Homepage photo swap",
  body: "Maren asked for this by today.",
  data: { type: "reminder", reminderId: "r1" },
};
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) });

describe("sendPush", () => {
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Push");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    db = makeDb((op) =>
      op.table === "push_tokens" && op.action === "select"
        ? { data: [{ token: "ExponentPushToken[good]" }, { token: "ExponentPushToken[dead]" }] }
        : undefined,
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  // Review Focus 3: a dead token.
  it("sends to every token, removes one the push service says is gone, and counts both", async () => {
    fetchMock.mockResolvedValue(
      ok([
        { status: "ok", id: "x" },
        { status: "error", details: { error: "DeviceNotRegistered" } },
      ]),
    );
    expect(await sendPush("u1", message)).toEqual({ sent: 1, dead: 1 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    const body = JSON.parse(init.body);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      to: "ExponentPushToken[good]",
      title: "Homepage photo swap",
      body: "Maren asked for this by today.",
      data: { type: "reminder", reminderId: "r1" },
      sound: "default",
    });

    const del = db.ops.find((o) => o.table === "push_tokens" && o.action === "delete");
    expect(eqValue(del!, "token")).toBe("ExponentPushToken[dead]");
    expect(eqValue(del!, "user_id")).toBe("u1");
  });

  it("keeps a token that failed for another reason", async () => {
    fetchMock.mockResolvedValue(
      ok([{ status: "ok" }, { status: "error", details: { error: "MessageRateExceeded" } }]),
    );
    expect(await sendPush("u1", message)).toEqual({ sent: 1, dead: 0 });
    expect(db.ops.some((o) => o.action === "delete")).toBe(false);
  });

  it("makes no network call when the user has no tokens", async () => {
    db = makeDb(() => ({ data: [] }));
    expect(await sendPush("u1", message)).toEqual({ sent: 0, dead: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the push service is down", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(sendPush("u1", message)).rejects.toThrow(/500/);
  });
});
