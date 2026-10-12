import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "nodepod-worker-csp.spec.ts",
  timeout: 120_000,
  workers: 1,
  reporter: [["line"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4177",
    launchOptions: process.env.NODEPOD_BROWSER_CHANNEL
      ? { channel: process.env.NODEPOD_BROWSER_CHANNEL }
      : undefined,
  },
  webServer: {
    command: "pnpm exec vite --config tests/fixtures/worker-csp/vite.config.ts",
    url: "http://127.0.0.1:4177/",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
