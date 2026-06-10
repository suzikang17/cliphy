import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// Promo-asset harness: renders real extension components at exact CWS
// dimensions for screenshot capture. Run: pnpm --filter web exec vite --config vite.promo.config.ts
export default defineConfig({
  root: path.resolve(__dirname, "promo"),
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5179,
    fs: {
      // allow importing extension components + shared package across the monorepo
      allow: [path.resolve(__dirname, "../..")],
    },
  },
});
