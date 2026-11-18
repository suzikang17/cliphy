// Connecting Claude Code on this Mac to the coach (POST /api/mcp), without a
// key passing through the window or a command to paste. The Mac's own key is
// used: it lives on this Mac already, and Claude Code here is the same person
// on the same machine, so a second key would add a thing to lose and no
// protection.
//
// Claude Code is told through its own command (`claude mcp add`), never by
// writing its config file, which it may be writing at the same moment. A
// Mac app is started with a bare PATH, so the command runs in the owner's
// login shell, where `claude` (and the node an npm install needs) is found
// the same way it is in their terminal.

/** The name Claude Code knows the coach by. */
export const SERVER_NAME = "cliphy";

/** missing: no `claude` on this Mac. off: not connected. stale: connected with an old key. */
export type ClaudeCodeStatus = "missing" | "off" | "on" | "stale";

export interface ShellResult {
  code: number;
  output: string;
}

export interface ClaudeCodeDeps {
  /** Run a script in the owner's login shell, with these extra variables set. */
  run(script: string, env: Record<string, string>): Promise<ShellResult>;
  /** Claude Code's own config (~/.claude.json), or null when there is none. */
  readConfig(): string | null;
}

/** Exit code a shell gives for a command it cannot find. */
const NOT_FOUND = 127;

export const mcpUrl = (apiUrl: string): string => `${apiUrl.replace(/\/+$/, "")}/api/mcp`;

/** The same line the phone shows, for pasting by hand. */
export const mcpCommand = (key: string, apiUrl: string): string =>
  `claude mcp add --transport http --scope user ${SERVER_NAME} ${mcpUrl(apiUrl)} --header "Authorization: Bearer ${key}"`;

/** The key Claude Code holds for the coach, or null when it holds none. */
function heldKey(config: string | null): string | null | undefined {
  if (!config) return undefined;
  try {
    const parsed = JSON.parse(config) as {
      mcpServers?: Record<string, { headers?: Record<string, string> }>;
    };
    const server = parsed.mcpServers?.[SERVER_NAME];
    if (!server) return undefined;
    const auth = server.headers?.Authorization ?? server.headers?.authorization ?? "";
    return auth.replace(/^Bearer\s+/i, "") || null;
  } catch {
    return undefined;
  }
}

const FIND = `command -v claude >/dev/null 2>&1 || exit ${NOT_FOUND}`;

export function claudeCode(deps: ClaudeCodeDeps) {
  const installed = async () => (await deps.run(FIND, {})).code !== NOT_FOUND;

  return {
    async status(key: string | null): Promise<ClaudeCodeStatus> {
      const held = heldKey(deps.readConfig());
      if (held !== undefined) return held && held === key ? "on" : "stale";
      return (await installed()) ? "off" : "missing";
    },

    /** Point Claude Code at the coach with this key, replacing any earlier entry. */
    async connect(key: string, apiUrl: string): Promise<ClaudeCodeStatus> {
      const res = await deps.run(
        [
          FIND,
          `claude mcp remove --scope user ${SERVER_NAME} >/dev/null 2>&1`,
          `claude mcp add --transport http --scope user ${SERVER_NAME} "$CLIPHY_MCP_URL" --header "Authorization: Bearer $CLIPHY_MCP_KEY"`,
        ].join("\n"),
        { CLIPHY_MCP_URL: mcpUrl(apiUrl), CLIPHY_MCP_KEY: key },
      );
      if (res.code === NOT_FOUND) return "missing";
      // Its message goes to the window, which must never see the key.
      if (res.code !== 0) throw new Error(res.output.split(key).join("…").trim() || "Error");
      return "on";
    },

    /** Take the coach out of Claude Code. Nothing to do when it is not there. */
    async disconnect(): Promise<void> {
      if (heldKey(deps.readConfig()) === undefined) return;
      await deps.run(`${FIND}\nclaude mcp remove --scope user ${SERVER_NAME}`, {});
    },
  };
}

export type ClaudeCode = ReturnType<typeof claudeCode>;
