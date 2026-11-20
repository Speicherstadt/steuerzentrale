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
// A fresh database per run and a key for tests only (32 bytes of 0x07, publicly known). Workers load
// this file again: they inherit the directory of the main process through SZ_E2E_DATEN, where the
// Zentrale's log (with the setup code) and the first owner's session lie (e2e/hilfen/inhaber.ts)
process.env.SZ_E2E_DATEN ??= mkdtempSync(join(tmpdir(), "sz-test-e2e-"));
const daten = process.env.SZ_E2E_DATEN;
const testSchluessel = Buffer.alloc(32, 7).toString("base64");
const inhaberSitzung = join(daten, "inhaber.json");

export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  workers: process.env.CI ? 4 : "50%",
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "off" },
  projects: [
    // The first owner through the setup code, once: its session is every other test's
    {
      name: "einrichtung",
      testMatch: /einrichtung\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    {
      name: "desktop",
      dependencies: ["einrichtung"],
      use: { ...devices["Desktop Chrome"], launchOptions, storageState: inhaberSitzung },
    },
    {
      name: "phone",
      grep: /@phone/,
      dependencies: ["einrichtung"],
      use: { ...devices["Pixel 7"], launchOptions, storageState: inhaberSitzung },
    },
  ],
  webServer: [
    {
      // the log goes to a file: the setup code for the first owner stands there
      command: `bun apps/zentrale/src/main.ts > ${join(daten, "zentrale.log")} 2>&1`,
      port: zentralePort,
      reuseExistingServer: false,
      env: {
        STEUERZENTRALE_PORT: String(zentralePort),
        STEUERZENTRALE_DATA: daten,
        STEUERZENTRALE_SECRET_KEY: testSchluessel,
        // the origin people use: the interface on Vite's port, which passes /api on
        STEUERZENTRALE_URL: `http://localhost:${port}`,
      },
    },
    {
      command: "bun run --cwd apps/web build --mode demo && bun run --cwd apps/web preview",
      port,
      reuseExistingServer: false,
      env: { STEUERZENTRALE_API_PORT: String(zentralePort) },
    },
  ],
});
