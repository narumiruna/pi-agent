import { defineConfig } from "@playwright/test";

const appPort = Number(process.env.E2E_APP_PORT ?? "39110");
const baseURL = `http://127.0.0.1:${appPort}`;
const authState = ".local/e2e/state/owner.json";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: ".local/e2e/results",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: ".local/e2e/report" }],
  ],
  use: {
    baseURL,
    locale: "en-US",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run e2e:server",
    url: `${baseURL}/health/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "desktop",
      dependencies: ["setup"],
      testMatch: /desktop\/.*\.spec\.ts/,
      use: { storageState: authState },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      testMatch: /mobile\/.*\.spec\.ts/,
      use: {
        storageState: authState,
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});

export { authState, baseURL };
