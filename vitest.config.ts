import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["allure-vitest/setup"],
    reporters: [
      "default",
      [
        "allure-vitest/reporter",
        {
          resultsDir: "./allure-results",
          categories: [
            {
              name: "Infrastructure",
              messageRegex: ".*timeout.*|.*ECONNREFUSED.*",
              matchedStatuses: ["broken", "failed"],
            },
            { name: "Product defects", matchedStatuses: ["failed"] },
            { name: "Test defects", matchedStatuses: ["broken"] },
          ],
          environmentInfo: {
            node: process.version,
            os: process.platform,
          },
        },
      ],
    ],
  },
});
