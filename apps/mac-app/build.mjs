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
  const result = spawnSync(
    "npx", // --clear: the bundler's cache does not notice EXPO_PUBLIC_TARGET changing, and
    // would hand back the copy built for cliphy.app, which asks for a sign-in.
    ["expo", "export", "--platform", "web", "--clear", "--output-dir", out],
    {
      cwd: path.resolve(import.meta.dirname, "../mobile"),
      stdio: "inherit",
      // "mac": no sign-in, the Mac app answers /api/ (apps/mobile/lib/desktop.ts).
      env: { ...process.env, EXPO_PUBLIC_API_URL: "", EXPO_PUBLIC_TARGET: "mac", CI: "1" },
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
