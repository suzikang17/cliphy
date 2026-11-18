import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCode, mcpCommand, type ShellResult } from "../claudeCode.js";

// Claude Code on this Mac pointed at the coach with the Mac's own key, by its
// own `claude mcp` command run in the owner's shell.

const KEY = "cliphy_sk_mac";
const API = "https://api.cliphy.app/";

const config = (key: string) =>
  JSON.stringify({
    mcpServers: {
      cliphy: { type: "http", url: "x", headers: { Authorization: `Bearer ${key}` } },
    },
  });

function fake(opts: { installed?: boolean; config?: string | null; fail?: string } = {}) {
  const runs: { script: string; env: Record<string, string> }[] = [];
  const cc = claudeCode({
    run: async (script, env): Promise<ShellResult> => {
      runs.push({ script, env });
      if (opts.installed === false) return { code: 127, output: "" };
      if (opts.fail && script.includes("mcp add")) return { code: 1, output: opts.fail };
      return { code: 0, output: "" };
    },
    readConfig: () => opts.config ?? null,
  });
  return { cc, runs };
}

describe("status", () => {
  it("is on when Claude Code holds this Mac's key", async () => {
    expect(await fake({ config: config(KEY) }).cc.status(KEY)).toBe("on");
  });

  it("is stale when Claude Code holds another key, as after connecting the Mac again", async () => {
    expect(await fake({ config: config("cliphy_sk_old") }).cc.status(KEY)).toBe("stale");
  });

  it("is off when Claude Code is installed but has no coach", async () => {
    expect(await fake({ config: JSON.stringify({ mcpServers: {} }) }).cc.status(KEY)).toBe("off");
  });

  it("is missing when there is no claude command", async () => {
    expect(await fake({ installed: false }).cc.status(KEY)).toBe("missing");
  });

  it("reads a broken config as not connected", async () => {
    expect(await fake({ config: "{not json" }).cc.status(KEY)).toBe("off");
  });
});

describe("connect", () => {
  it("replaces any earlier entry and adds the coach, the key passed as a variable", async () => {
    const { cc, runs } = fake();
    expect(await cc.connect(KEY, API)).toBe("on");
    const [{ script, env }] = runs;
    expect(script.indexOf("mcp remove")).toBeLessThan(script.indexOf("mcp add"));
    expect(script).not.toContain(KEY);
    expect(env).toEqual({
      CLIPHY_MCP_URL: "https://api.cliphy.app/api/mcp",
      CLIPHY_MCP_KEY: KEY,
    });
  });

  it("says missing when there is no claude command", async () => {
    expect(await fake({ installed: false }).cc.connect(KEY, API)).toBe("missing");
  });

  it("throws Claude Code's own message, without the key in it", async () => {
    const { cc } = fake({ fail: `bad header Bearer ${KEY}\n` });
    await expect(cc.connect(KEY, API)).rejects.toThrow("bad header Bearer …");
  });
});

describe("disconnect", () => {
  it("removes the coach when Claude Code has it", async () => {
    const { cc, runs } = fake({ config: config(KEY) });
    await cc.disconnect();
    expect(runs[0].script).toContain("claude mcp remove --scope user cliphy");
  });

  it("runs nothing when it is not there", async () => {
    const { cc, runs } = fake({ config: null });
    await cc.disconnect();
    expect(runs).toEqual([]);
  });
});

describe("the script in a real shell", () => {
  it("adds the coach with the URL and key a fake claude receives", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "claude-"));
    const log = path.join(dir, "log");
    const bin = path.join(dir, "claude");
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`);
    chmodSync(bin, 0o755);
    const cc = claudeCode({
      run: async (script, env) => {
        try {
          const output = execFileSync("/bin/sh", ["-c", script], {
            env: { PATH: `${dir}:/usr/bin:/bin`, ...env },
            encoding: "utf8",
          });
          return { code: 0, output };
        } catch (err) {
          const e = err as { status: number; stdout: string };
          return { code: e.status, output: e.stdout };
        }
      },
      readConfig: () => null,
    });
    expect(await cc.connect(KEY, API)).toBe("on");
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "mcp remove --scope user cliphy",
      `mcp add --transport http --scope user cliphy https://api.cliphy.app/api/mcp --header Authorization: Bearer ${KEY}`,
    ]);
  });
});

it("gives the same line the phone shows", () => {
  expect(mcpCommand(KEY, API)).toBe(
    `claude mcp add --transport http --scope user cliphy https://api.cliphy.app/api/mcp --header "Authorization: Bearer ${KEY}"`,
  );
});
