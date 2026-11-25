import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// What a user does, on the desktop and on a phone: every spec runs on `desktop`, specs tagged @phone
// also on `phone`. The e2e ports (Zentrale 28300, Vite 5182) keep clear of a running dev server
// (CLAUDE.md, "Working rules"). Layout from Speicherstadt/kennwort, playwright.config.ts.
const port = 5182;
const zentralePort = 28300;
// The stand-in for Cloudflare's API (Z-407, apps/zentrale/src/testhilfen/cloudflare.ts): no DNS
// record of a test ever reaches Cloudflare
const cloudflarePort = 28301;
// The stand-in for MinIO's admin API (Z-601, apps/zentrale/src/testhilfen/minio.ts): the S3 target
// the e2e tests set; no test makes an access at a real MinIO
const minioPort = 28302;
// The stand-in for a container registry (Z-501, apps/zentrale/src/testhilfen/registry.ts): every
// registry a manifest names is asked here, with probe's tags 1.0.0 and 9.0.0
const registryPort = 28303;
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
// The demo build with its fixtures and hash routes (e2e/demo.spec.ts), no Zentrale behind it
const demoPort = 5184;
// The public test key as the Zentrale's `minisign.pub` (beside install.sh): it checks an uploaded
// manifest with it (Z-402), and e2e/hilfen/installationen.ts signs with the test key's secret half
const agentDateien = join(daten, "agent-dateien");
mkdirSync(agentDateien, { recursive: true });
copyFileSync(
  join(import.meta.dirname, "test/schluessel/test.pub"),
  join(agentDateien, "minisign.pub"),
);

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
      testIgnore: /demo\.spec/,
      use: { ...devices["Desktop Chrome"], launchOptions, storageState: inhaberSitzung },
    },
    {
      name: "phone",
      grep: /@phone/,
      dependencies: ["einrichtung"],
      testIgnore: /demo\.spec/,
      use: { ...devices["Pixel 7"], launchOptions, storageState: inhaberSitzung },
    },
    // every route of the demo build, which no signed-in spec sees
    {
      name: "demo",
      testMatch: /demo\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions,
        baseURL: `http://localhost:${demoPort}/steuerzentrale/demo/`,
      },
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
        // where agents reach it: the install command of the dialog "Server hinzufügen" names it
        STEUERZENTRALE_AGENT_URL: `http://localhost:${zentralePort}`,
        STEUERZENTRALE_AGENT_DATEIEN: agentDateien,
        STEUERZENTRALE_CLOUDFLARE_API: `http://127.0.0.1:${cloudflarePort}/client/v4`,
        STEUERZENTRALE_REGISTRY_HTTP: `http://127.0.0.1:${registryPort}`,
        // the hosts of e2e installations are made up: no check from outside (Z-704) asks for them
        STEUERZENTRALE_AUSSEN_PRUEFUNG: "aus",
      },
    },
    {
      command: `bun apps/zentrale/src/testhilfen/cloudflare.ts ${cloudflarePort}`,
      port: cloudflarePort,
      reuseExistingServer: false,
    },
    {
      command: `bun apps/zentrale/src/testhilfen/minio.ts ${minioPort}`,
      port: minioPort,
      reuseExistingServer: false,
    },
    {
      command: `bun apps/zentrale/src/testhilfen/registry.ts ${registryPort} probe=1.0.0,9.0.0`,
      port: registryPort,
      reuseExistingServer: false,
    },
    {
      command: "bun run --cwd apps/web build --mode demo && bun run --cwd apps/web preview",
      port,
      reuseExistingServer: false,
      env: { STEUERZENTRALE_API_PORT: String(zentralePort) },
    },
    {
      // the demo as `build:demo` makes it (apps/web/package.json), in a folder of its own
      command: `cd apps/web && bunx vite build --mode demo --outDir dist-demo-e2e && bunx vite preview --outDir dist-demo-e2e --port ${demoPort} --strictPort`,
      port: demoPort,
      reuseExistingServer: false,
      env: {
        VITE_OHNE_ANMELDUNG: "1",
        VITE_DEMO_SEITE: "1",
        STEUERZENTRALE_WEB_BASE: "/steuerzentrale/demo/",
      },
    },
  ],
});
