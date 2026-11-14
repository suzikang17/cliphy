import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { layer, epic, feature } from "allure-js-commons";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApi } from "../api.js";
import { prepareImage } from "../images.js";
import { loadState, saveState, loadConfig, saveConfig } from "../store.js";
import { launchdPlist } from "../launchd.js";
import { emptyState } from "../sync.js";
import { mimeFor } from "../convert.js";

const fetchMock = vi.fn();
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => "",
});

describe("mac helper program parts", () => {
  let dir: string;
  beforeEach(() => {
    layer("unit");
    epic("Coach");
    feature("Mac helper");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    dir = mkdtempSync(path.join(tmpdir(), "cliphy-helper-"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("calls the coach API with the key, under /api/coach", async () => {
    fetchMock.mockResolvedValue(ok({ people: [{ id: "p1" }] }));
    const api = createApi({ apiUrl: "https://api.example.com/", apiKey: "key-123" });
    expect(await api.people()).toEqual([{ id: "p1" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/coach/people");
    expect(init.headers.Authorization).toBe("Bearer key-123");
  });

  it("uploads messages as iMessage captures with the historical flag", async () => {
    fetchMock.mockResolvedValue(ok({ stored: 1 }));
    const api = createApi({ apiUrl: "https://api.example.com", apiKey: "k" });
    await api.postMessages({ personId: "p1", historical: true, messages: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/coach/intake/messages");
    expect(JSON.parse(init.body)).toEqual({
      personId: "p1",
      channel: "imessage",
      historical: true,
      messages: [],
    });
  });

  it("puts attachment bytes to the signed address with their type", async () => {
    fetchMock.mockResolvedValue(ok({}));
    const api = createApi({ apiUrl: "https://api.example.com", apiKey: "k" });
    await api.put("https://storage/signed?token=t", Buffer.from("x"), "image/jpeg");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://storage/signed?token=t");
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("image/jpeg");
    // The storage address carries its own token; the API key must not go to it.
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("fails loudly when the server refuses, so the cursor is not moved", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "boom",
    });
    const api = createApi({ apiUrl: "https://api.example.com", apiKey: "k" });
    await expect(
      api.postMessages({ personId: "p1", historical: false, messages: [] }),
    ).rejects.toThrow(/500/);
  });

  it("skips an attachment that is not an image or is not on disk", async () => {
    expect(await prepareImage(path.join(dir, "contract.pdf"), "application/pdf")).toBeNull();
    expect(await prepareImage(path.join(dir, "gone.png"), "image/png")).toBeNull();
    expect(await prepareImage(path.join(dir, "x"), null)).toBeNull();
  });

  it("passes a readable image through untouched", async () => {
    const file = path.join(dir, "page1.png");
    writeFileSync(file, Buffer.from("png-bytes"));
    const out = await prepareImage(file, "image/png");
    expect(out?.mediaType).toBe("image/png");
    expect(out?.bytes.toString()).toBe("png-bytes");
  });

  it("converts a HEIC photo to JPEG, and skips it if it cannot", async () => {
    const file = path.join(dir, "photo.heic");
    writeFileSync(file, Buffer.from("heic-bytes"));
    const converted = await prepareImage(file, "image/heic", async (_src, out) => {
      writeFileSync(out, Buffer.from("jpeg-bytes"));
    });
    expect(converted).toEqual({ bytes: Buffer.from("jpeg-bytes"), mediaType: "image/jpeg" });

    const failed = await prepareImage(file, "image/heic", async () => {
      throw new Error("sips not found");
    });
    expect(failed).toBeNull();
  });

  it("keeps the key and the cursor in files only the user can read", () => {
    saveConfig(dir, { apiUrl: "https://api.example.com", apiKey: "secret" });
    saveState(dir, { ...emptyState(), cursors: { p1: 41 }, connected: { p1: true } });
    expect(loadConfig(dir)).toEqual({ apiUrl: "https://api.example.com", apiKey: "secret" });
    expect(loadState(dir).cursors.p1).toBe(41);
    expect(statSync(path.join(dir, "config.json")).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(dir, "state.json")).mode & 0o777).toBe(0o600);
  });

  it("starts with an empty state, and survives a damaged state file", () => {
    expect(loadState(dir)).toEqual(emptyState());
    writeFileSync(path.join(dir, "state.json"), "{ not json");
    expect(loadState(dir)).toEqual(emptyState());
    // The right shape with a null where a map belongs must not crash a cycle.
    writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({ cursors: null, connected: { p1: true } }),
    );
    expect(loadState(dir)).toEqual({ ...emptyState(), connected: { p1: true } });
    expect(loadConfig(dir)).toBeNull();
  });

  it("writes the state in one step, so a crash cannot leave half a file", () => {
    saveState(dir, { ...emptyState(), cursors: { p1: 41 } });
    expect(readdirSync(dir).sort()).toEqual(["state.json"]);
  });

  it("writes a launchd job that runs at login and restarts itself", () => {
    const plist = launchdPlist({
      node: "/usr/local/bin/node",
      main: "/Users/me/cliphy/apps/mac-helper/src/main.ts",
      cwd: "/Users/me/cliphy/apps/mac-helper",
      logDir: "/Users/me/.cliphy-helper",
    });
    expect(plist).toContain("<string>app.cliphy.helper</string>");
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>run</string>");
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    // Restarted if it crashes, but not in a loop when it exits cleanly to wait for setup.
    expect(plist).toMatch(
      /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>\s*<\/dict>/,
    );
    expect(plist).toContain("/Users/me/.cliphy-helper/helper.log");
  });

  it("works out an attachment's type from the mime type, then the uti, then the file name", () => {
    expect(mimeFor("image/heic", "public.png", "a.jpg")).toBe("image/heic");
    expect(mimeFor(null, "public.heic", "a.bin")).toBe("image/heic");
    expect(mimeFor(null, "public.jpeg", null)).toBe("image/jpeg");
    expect(mimeFor(null, null, "/x/IMG_1.JPG")).toBe("image/jpeg");
    expect(mimeFor(null, null, "/x/shot.PNG")).toBe("image/png");
    expect(mimeFor(null, "com.adobe.pdf", "/x/contract.pdf")).toBeNull();
    expect(mimeFor(null, null, null)).toBeNull();
  });
});
