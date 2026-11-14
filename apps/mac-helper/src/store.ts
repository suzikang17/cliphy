import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { emptyState, type HelperState } from "./sync.js";

// The helper's two small files: who it is (the API key) and where it got to
// (the cursor). Both are readable only by the user.

export const DEFAULT_DIR = path.join(homedir(), ".cliphy-helper");

export interface HelperConfig {
  apiUrl: string;
  apiKey: string;
  /** The account's email, when the key came from pairing. Shown, never used to sign in. */
  account?: string;
}

/** Written to a temporary file and renamed, so a crash cannot leave half a file behind. */
function write(dir: string, name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, name);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
}

function read<T>(dir: string, name: string): T | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, name), "utf8")) as T;
  } catch {
    return null;
  }
}

export function saveConfig(dir: string, config: HelperConfig): void {
  write(dir, "config.json", config);
}

export function loadConfig(dir: string): HelperConfig | null {
  const config = read<Partial<HelperConfig>>(dir, "config.json");
  if (!config?.apiUrl || !config.apiKey) return null;
  return {
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    ...(typeof config.account === "string" ? { account: config.account } : {}),
  };
}

/** Forget the key, so the helper has to be paired again. */
export function clearConfig(dir: string): void {
  rmSync(path.join(dir, "config.json"), { force: true });
}

export function saveState(dir: string, state: HelperState): void {
  write(dir, "state.json", state);
}

/** A missing or damaged state file starts over; the server ignores anything it already has. */
export function loadState(dir: string): HelperState {
  const saved = read<Record<string, unknown>>(dir, "state.json") ?? {};
  const state = emptyState();
  // Take each part only if it has the right kind of value; a null or missing
  // part keeps its empty default, so a damaged file cannot crash a cycle.
  for (const key of Object.keys(state) as (keyof HelperState)[]) {
    const value = saved[key];
    if (key === "lastSyncAt") {
      if (typeof value === "string") state.lastSyncAt = value;
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      (state[key] as unknown) = value;
    }
  }
  return state;
}
