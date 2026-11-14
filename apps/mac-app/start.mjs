import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

// Runs the app from source. It is started through `open`, not as a child of
// this terminal: macOS charges Full Disk Access to whichever program started
// the process, so a child of the terminal is refused Messages even when
// Electron.app is switched on.
const executable = createRequire(import.meta.url)("electron");
const bundle = executable.replace(/\/Contents\/MacOS\/[^/]+$/, "");
const result = spawnSync(
  "open",
  ["-W", "-n", "-a", bundle, "--args", import.meta.dirname, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
