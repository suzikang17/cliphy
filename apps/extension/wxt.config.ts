import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "Cliphy",
    description: "Queue YouTube videos and get AI-powered summaries",
    version: "0.0.1",
    permissions: ["storage", "activeTab", "tabs", "identity", "contextMenus"],
    host_permissions: ["https://www.youtube.com/*"],
  },
});
