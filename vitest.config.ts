import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["allure-vitest/setup"],
    reporters: ["default", "allure-vitest/reporter"],
    outputFile: {
      "allure-vitest/reporter": "./allure-results",
    },
  },
});
