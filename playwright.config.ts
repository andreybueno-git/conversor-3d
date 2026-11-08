import { defineConfig, devices } from "@playwright/test";
const executablePath = process.env.CHROMIUM ?? undefined;
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: "http://localhost:4321", trace: "off", launchOptions: { executablePath } },
  webServer: { command: "node e2e/servidor.mjs", port: 4321, reuseExistingServer: true },
  projects: [
    { name: "celular", use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
  ],
});
