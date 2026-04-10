import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAh7dyfIsSttx5YvhSIZa3ip65nvA/Smvr0+ucLxZjKcRwl8qAsc8tObthwSQlj8kKl/VQiVCZiXVHZWxqjIWF7kqycP5knax4ahSk0pQ3XVVJFUWtNxW2QCeYW6/44I6VG5yVa3R2QlgZP6jFRCKkaDhtdMdq3/mOOU2zM0I8zvTVyJbJzlQL8QkFfgui1R5nX1/Sc1SZKtV2e1pvCz4DvV9zFh3ihzev2p0GZLBzVx28AuRpi+WyUgAkmSQ0N0FouwJSTs6w1ykHyw/zzyHdRfhUGAR5ubn3+bRRE3Z2U+C8gHX3OGvLSusYv06L7+/wN6aE3SnFBJXNCNcELx31NQIDAQAB",
    name: "Cliphy",
    description: "Queue YouTube videos and get AI-powered summaries",
    version: "1.0.0",
    permissions: ["storage", "tabs", "identity", "contextMenus", "sidePanel"],
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    action: {
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
    },
    host_permissions: ["https://www.youtube.com/*"],
  },
});
