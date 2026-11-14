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
