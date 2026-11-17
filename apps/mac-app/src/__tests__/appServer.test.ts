import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createAppServer } from "../appServer.js";

// The window's pages and its API calls both come through here: files from the
// built app, and /api/ calls passed on to Cliphy with the Mac's own key added.

let webDir: string;
let calls: Request[];
let key: string | null;

const server = () =>
  createAppServer({
    webDir,
    apiUrl: "https://api.example.test/",
    apiKey: () => key,
    fetch: async (request) => {
      calls.push(request);
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

beforeEach(() => {
  webDir = mkdtempSync(path.join(tmpdir(), "cliphy-web-"));
  mkdirSync(path.join(webDir, "_expo", "static"), { recursive: true });
  writeFileSync(path.join(webDir, "index.html"), "<html>app</html>");
  writeFileSync(path.join(webDir, "_expo", "static", "entry.js"), "console.log(1)");
  writeFileSync(path.join(webDir, "..", "secret.txt"), "no");
  calls = [];
  key = "cliphy_sk_test";
});

describe("pages", () => {
  it("serves a built file with its type", async () => {
    const res = await server()(new Request("app://cliphy/_expo/static/entry.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("javascript");
    expect(await res.text()).toBe("console.log(1)");
  });

  it("serves the app for the root and for any screen's address", async () => {
    for (const url of ["app://cliphy/", "app://cliphy/coach/project/abc", "app://cliphy/chat"]) {
      const res = await server()(new Request(url));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(await res.text()).toBe("<html>app</html>");
    }
  });

  it("answers 404 for a missing file rather than the app", async () => {
    const res = await server()(new Request("app://cliphy/_expo/static/missing.js"));
    expect(res.status).toBe(404);
  });

  it("never reads outside the built app", async () => {
    for (const url of ["app://cliphy/../secret.txt", "app://cliphy/%2e%2e/secret.txt"]) {
      const res = await server()(new Request(url));
      expect(await res.text()).not.toBe("no");
    }
  });

  it("refuses anything but reading a page", async () => {
    const res = await server()(new Request("app://cliphy/index.html", { method: "POST" }));
    expect(res.status).toBe(405);
  });
});

describe("API calls", () => {
  it("passes the call on with the Mac's key in place of the page's", async () => {
    const res = await server()(
      new Request("app://cliphy/api/coach/projects?active=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer desktop" },
        body: JSON.stringify({ name: "Alder House" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.test/api/coach/projects?active=1");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("Authorization")).toBe("Bearer cliphy_sk_test");
    expect(calls[0].headers.get("Content-Type")).toBe("application/json");
    expect(await calls[0].json()).toEqual({ name: "Alder House" });
  });

  it("answers 401 without calling out when the Mac is not connected", async () => {
    key = null;
    const res = await server()(new Request("app://cliphy/api/coach/projects"));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("answers 502 when Cliphy cannot be reached", async () => {
    const handle = createAppServer({
      webDir,
      apiUrl: "https://api.example.test",
      apiKey: () => key,
      fetch: async () => {
        throw new Error("offline");
      },
    });
    const res = await handle(new Request("app://cliphy/api/coach/projects"));
    expect(res.status).toBe(502);
  });

  it("does not send the page's cookies or origin along", async () => {
    await server()(
      new Request("app://cliphy/api/coach/health", {
        headers: { Cookie: "a=b", "X-Other": "1" },
      }),
    );
    expect(calls[0].headers.get("Cookie")).toBeNull();
    expect(calls[0].headers.get("X-Other")).toBeNull();
  });
});
