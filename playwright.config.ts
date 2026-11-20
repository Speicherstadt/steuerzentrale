import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// What a user does, on the desktop and on a phone: every spec runs on `desktop`, specs tagged @phone
// also on `phone`. The e2e ports (Zentrale 28300, Vite 5182) keep clear of a running dev server
// (CLAUDE.md, "Working rules"). Layout from Speicherstadt/kennwort, playwright.config.ts.
const port = 5182;
const zentralePort = 28300;
// Where the pinned Playwright's own browser is missing (some sandboxes), CHROMIUM_PATH names another
const executablePath = process.env.CHROMIUM_PATH;
const launchOptions = executablePath ? { executablePath } : {};
// A fresh database per run and a key for tests only (32 bytes of 0x07, publicly known)
const daten = mkdtempSync(join(tmpdir(), "sz-test-e2e-"));
const testSchluessel = Buffer.alloc(32, 7).toString("base64");

export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  workers: process.env.CI ? 4 : "50%",
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions } },
    { name: "phone", grep: /@phone/, use: { ...devices["Pixel 7"], launchOptions } },
  ],
  webServer: [
    {
      command: "bun apps/zentrale/src/main.ts",
      port: zentralePort,
      reuseExistingServer: false,
      env: {
        STEUERZENTRALE_PORT: String(zentralePort),
        STEUERZENTRALE_DATA: daten,
        STEUERZENTRALE_SECRET_KEY: testSchluessel,
      },
    },
    {
      command: "bun run --cwd apps/web build && bun run --cwd apps/web preview",
      port,
      reuseExistingServer: false,
      env: { STEUERZENTRALE_API_PORT: String(zentralePort) },
    },
  ],
});
