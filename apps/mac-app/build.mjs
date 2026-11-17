import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

// One file each for the main process and the preload script, with the helper's
// code bundled in, so the packaged app carries no node_modules.
const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  logLevel: "info",
};
await build({ ...shared, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs" });
await build({ ...shared, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs" });
await build({ ...shared, entryPoints: ["src/preview.ts"], outfile: "dist/preview.cjs" });

// The full app shown in the window is the phone app built for the web
// (apps/mobile). It calls /api/ on its own address, which the Mac app answers.
// `--no-web` skips this when only the Mac's own code changed.
if (!process.argv.includes("--no-web")) {
  const out = path.resolve(import.meta.dirname, "web");
  rmSync(out, { recursive: true, force: true });
  const result = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", out], {
    cwd: path.resolve(import.meta.dirname, "../mobile"),
    stdio: "inherit",
    env: { ...process.env, EXPO_PUBLIC_API_URL: "", CI: "1" },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
