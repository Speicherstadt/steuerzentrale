import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { agentVerbinden } from "./hilfen/agent.ts";
import {
  eigeneApp,
  manifestDateien,
  manifestImportieren,
  neuerHost,
} from "./hilfen/installationen.ts";
import { kundeAnlegen } from "./hilfen/kunden.ts";

test.use({ locale: "de-DE" });

/** No finding of axe on the page as it stands, an open dialog included */
const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

const ZEICHEN = "abcdefghijklmnopqrstuvwxyz";
/** An app id no other test or run imports: an imported version never changes */
const neueApp = () => `probe-${Array.from({ length: 8 }, () => ZEICHEN[randomInt(26)]).join("")}`;

const kachel = (page: Page, app: string) =>
  page.locator("main section", { has: page.getByRole("link", { name: app, exact: true }) });

// BAULISTE.md Z-501 against the real Zentrale with the first owner's session: a signed manifest
// imported through the dialog on the page Apps, installed from in the dialog "App installieren",
// a newer version of the registry (the stand-in, apps/zentrale/src/testhilfen/registry.ts) shown
// on the app's tile and page as "Manifest fehlt", and a customer marked as internal, who alone gets the
// pre-release offered.
test.describe("manifests and versions", { tag: "@phone" }, () => {
  test("imports a signed manifest in the dialog, and refuses other text for its version", async ({
    page,
  }) => {
    const app = neueApp();
    const dateien = manifestDateien(eigeneApp(app));
    await page.goto("/katalog");
    await page.getByRole("button", { name: "Manifest importieren" }).click();
    const dialog = page.getByRole("dialog", { name: "Manifest importieren" });
    await dialog.getByLabel("Manifest (manifest.yml)").setInputFiles(dateien.manifest);
    await dialog.getByLabel("Signatur (manifest.yml.minisig)").setInputFiles(dateien.signatur);
    await dialog.getByLabel("Grund").fill("Release 1.0.0");
    await ohneBefund(page);
    await dialog.getByRole("button", { name: "Importieren" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status")).toHaveText(`${app} 1.0.0 ist importiert.`);
    await expect(kachel(page, app)).toContainText("Version 1.0.0");
    await kachel(page, app).getByRole("link", { name: app, exact: true }).click();
    await expect(page).toHaveURL(`/katalog/${app}`);
    await expect(page.locator("main h1")).toHaveText(app);
    await expect(page.getByTestId("app-version")).toContainText("1.0.0verfügbar");
    await page.goto("/katalog");

    const anders = manifestDateien(`${eigeneApp(app)}hinweis: anders\n`);
    await page.getByRole("button", { name: "Manifest importieren" }).click();
    await dialog.getByLabel("Manifest (manifest.yml)").setInputFiles(anders.manifest);
    await dialog.getByLabel("Signatur (manifest.yml.minisig)").setInputFiles(anders.signatur);
    await dialog.getByLabel("Grund").fill("anders");
    await dialog.getByRole("button", { name: "Importieren" }).click();
    await expect(dialog.getByRole("alert")).toContainText("schon mit anderem Inhalt importiert");
    await ohneBefund(page);
  });

  test("shows a newer version of the registry as manifest missing", async ({ page }) => {
    await manifestImportieren(page.request);
    await page.goto("/katalog");
    await page.getByRole("button", { name: "Nach neuen Versionen suchen" }).click();
    await expect(kachel(page, "probe")).toContainText("9.0.0 erschienen – Manifest fehlt noch");
    await page.goto("/katalog/probe");
    await expect(
      page.getByTestId("app-version").filter({ hasText: "9.0.0Manifest fehlt" }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText(
      "Registry registry.example.org/probe, abgefragt",
    );
    await ohneBefund(page);
  });

  test("marks a customer as internal, who alone is offered the pre-release", async ({ page }) => {
    const app = neueApp();
    const vorab = eigeneApp(app).replace("version: 1.0.0", "version: 2.0.0-rc.1");
    await manifestImportieren(page.request, eigeneApp(app));
    await manifestImportieren(page.request, vorab);
    const kunde = await kundeAnlegen(page.request, "Eigene Firma");
    const agent = await agentVerbinden(page.request, "Gemeinsamer Server");
    try {
      await page.goto(`/kunden/${kunde.id}`);
      const versionen = async () => {
        await page.getByRole("button", { name: "App installieren" }).click();
        const dialog = page.getByRole("dialog", { name: "App installieren" });
        await dialog.getByLabel("App", { exact: true }).selectOption(app);
        const werte = await dialog
          .getByLabel("Version", { exact: true })
          .locator("option")
          .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter(Boolean));
        await dialog.getByRole("button", { name: "Abbrechen" }).click();
        return werte;
      };
      expect(await versionen()).toEqual(["1.0.0"]);

      await page.getByRole("button", { name: "Als intern markieren" }).click();
      const dialog = page.getByRole("dialog", { name: `${kunde.name} als intern markieren` });
      await dialog.getByLabel("Grund").fill("unsere eigene Installation");
      await ohneBefund(page);
      await dialog.getByRole("button", { name: "Als intern markieren" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("button", { name: "Nicht mehr intern" })).toBeVisible();
      await expect(page.locator("main")).toContainText("Welle");
      expect(await versionen()).toEqual(["2.0.0-rc.1", "1.0.0"]);

      // and installs it from the imported manifest
      await page.getByRole("button", { name: "App installieren" }).click();
      const installieren = page.getByRole("dialog", { name: "App installieren" });
      await installieren.getByLabel("Server", { exact: true }).selectOption(agent.serverId);
      await installieren.getByLabel("App", { exact: true }).selectOption(app);
      await installieren.getByLabel("Version", { exact: true }).selectOption("2.0.0-rc.1");
      await expect(installieren.getByTestId("platzierung")).toContainText("Passt");
      await installieren.getByLabel("PROBE_KENNWORT").fill("kennwort-der-installation");
      await installieren.getByLabel("Adresse").fill(neuerHost());
      await installieren.getByLabel("Grund").fill("Vorabversion testen");
      await installieren.getByRole("button", { name: "Installieren" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${kunde.name} · ${app}`);
      await expect(page.getByText("2.0.0-rc.1").first()).toBeVisible();
    } finally {
      agent.trennen();
    }
  });
});
