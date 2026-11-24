import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;
// Overridable so several runners can share one machine.
const API_PORT = process.env.API_PORT ?? "3000";
const WEB_PORT = process.env.WEB_PORT ?? "3001";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  // CLI --workers overrides; the stress workflow sweeps it.
  workers: CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/, teardown: "cleanup" },
    { name: "cleanup", testMatch: /.*\.teardown\.ts/ },
    ...(
      [
        ["chromium", "Desktop Chrome"],
        ["firefox", "Desktop Firefox"],
        ["webkit", "Desktop Safari"],
      ] as const
    ).map(([name, device]) => ({
      name,
      use: { ...devices[device] },
      dependencies: ["setup"],
    })),
  ],
  webServer: [
    {
      command: CI ? "bun run -F server start" : "bun run -F server dev",
      cwd: "../..",
      url: `http://localhost:${API_PORT}`,
      env: { PORT: API_PORT },
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: `bunx next ${CI ? "start" : "dev"} --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
