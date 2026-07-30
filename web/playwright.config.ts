import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const webRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(webRoot, "..");
const backendPort = 8798;
const frontendPort = 5178;
const backendUrl = `http://127.0.0.1:${backendPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-1365x768",
      use: { viewport: { width: 1365, height: 768 } },
    },
    {
      name: "chromium-1920x1080",
      use: { viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: [
    {
      command: `uv run uvicorn glitchloom.server:app --host 127.0.0.1 --port ${backendPort}`,
      cwd: repositoryRoot,
      env: {
        ...process.env,
        GLITCHLOOM_WORKSPACE: join(tmpdir(), `glitchloom-playwright-${process.pid}`),
      },
      url: `${backendUrl}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run dev -- --port ${frontendPort}`,
      cwd: webRoot,
      env: {
        ...process.env,
        GLITCHLOOM_API_TARGET: backendUrl,
      },
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
