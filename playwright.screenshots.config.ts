import { defineConfig, devices } from "@playwright/test";

// The pictures of README.md and docs/ (`bun run screenshots`, .github/workflows/screenshots.yml):
// the demo build with its fixtures (apps/web/src/demo), so no Zentrale, agent or server is needed.
// German, light and dark, desktop and phone, at deviceScaleFactor 2. Layout from
// Speicherstadt/kennwort, playwright.screenshots.config.ts. Never part of `bun run e2e`.
const port = 5183;
const executablePath = process.env.CHROMIUM_PATH;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "e2e/screenshots",
  testMatch: /\.shot\.ts$/,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}/steuerzentrale/demo/`, locale: "de-DE", trace: "off" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        launchOptions,
      },
    },
    { name: "phone", use: { ...devices["Pixel 7"], launchOptions } },
  ],
  webServer: {
    command: `bun run --cwd apps/web build:demo && bun run --cwd apps/web vite preview --outDir dist-demo --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    env: { STEUERZENTRALE_WEB_BASE: "/steuerzentrale/demo/" },
  },
});
