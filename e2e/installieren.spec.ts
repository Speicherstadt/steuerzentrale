import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { agentVerbinden } from "./hilfen/agent.ts";
import { installationAnlegen, manifestImportieren, neuerHost } from "./hilfen/installationen.ts";
import { kundeAnlegen } from "./hilfen/kunden.ts";

test.use({ locale: "de-DE" });

/** No finding of axe on the page as it stands, an open dialog included */
const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

// BAULISTE.md Z-402: the dialog "Installieren" against the real Zentrale with the first owner's
// session (e2e/einrichtung.setup.ts): app and version of an imported manifest chosen (Z-501), the
// placement live, the installation made with a reason. The stand-in agent (e2e/hilfen/agent.ts) runs no job, so the
// installation stays "wird eingerichtet"; the setup itself runs in CI (apps/agent).
test.describe("installing", { tag: "@phone" }, () => {
  test("places an app live and lists the installation as being set up", async ({ page }) => {
    const kunde = await kundeAnlegen(page.request, "Kanzlei Nord");
    const agent = await agentVerbinden(page.request, "Gemeinsamer Server");
    await manifestImportieren(page.request);
    const host = neuerHost();
    try {
      await page.goto("/apps");
      await page.getByRole("button", { name: "App installieren" }).click();
      const dialog = page.getByRole("dialog", { name: "App installieren" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/^Kunde, Server, App und Version wählen/)).toBeVisible();
      await expect(dialog.getByLabel("Manifest (manifest.yml)")).toHaveCount(0);
      await dialog.getByLabel("Kunde", { exact: true }).selectOption(kunde.id);
      await dialog.getByLabel("Server", { exact: true }).selectOption(agent.serverId);
      await dialog.getByLabel("App", { exact: true }).selectOption("probe");
      await dialog.getByLabel("Version", { exact: true }).selectOption("1.0.0");
      await expect(dialog.getByText("Manifest probe 1.0.0")).toBeVisible();
      const platzierung = dialog.getByTestId("platzierung");
      await expect(platzierung).toContainText("Passt");
      await expect(platzierung).toContainText(`probe auf ${agent.name}`);

      // an option the server has no room for would show here; this one only adds its setting
      await dialog.getByLabel("Zusatzdienst").check();
      await expect(dialog.getByLabel("PROBE_EXTRA")).toBeVisible();
      await expect(platzierung).toContainText("Passt");
      await dialog.getByLabel("Zusatzdienst").uncheck();

      await dialog.getByLabel("PROBE_KENNWORT").fill("kennwort-der-installation");
      await dialog.getByLabel("Adresse").fill(host);
      await dialog.getByLabel("Grund").fill("Bestellung vom 20.11.");
      await ohneBefund(page);
      await dialog.getByRole("button", { name: "Installieren" }).click();
      await expect(dialog).toBeHidden();

      // the table shows no address, the search finds it
      await page.getByRole("searchbox", { name: "Apps suchen" }).fill(host);
      const zeile = page
        .locator("main tbody tr")
        .filter({ has: page.locator("a[href^='/apps/']") });
      await expect(zeile).toHaveCount(1);
      await expect(zeile).toContainText("wird eingerichtet");
      await expect(zeile).toContainText(kunde.name);
      await zeile.getByRole("link").click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`probe · ${kunde.name}`);
      await page.getByRole("tab", { name: "Technik" }).click();
      await expect(page.getByText("Einrichten", { exact: true })).toBeVisible();
      await expect(page.getByText(/^vom Agenten bestätigt/)).toBeVisible();
      await ohneBefund(page);
    } finally {
      agent.trennen();
    }
  });

  test("names the Zentrale's reasons when the app does not fit", async ({ page }) => {
    const kunde = await kundeAnlegen(page.request, "Kanzlei Süd");
    const agent = await agentVerbinden(page.request, "Gemeinsamer Server");
    agent.trennen();
    await expect
      .poll(async () => {
        const sv = await page.request.get(`/api/v1/server/${agent.serverId}`);
        return ((await sv.json()) as { agent: { zustand: string } }).agent.zustand;
      })
      .toBe("getrennt");
    await manifestImportieren(page.request);
    await page.goto(`/kunden/${kunde.id}`);
    await page.getByRole("button", { name: "App installieren" }).click();
    const dialog = page.getByRole("dialog", { name: "App installieren" });
    await expect(dialog.getByLabel("Kunde", { exact: true })).toHaveValue(kunde.id);
    await dialog.getByLabel("Server", { exact: true }).selectOption(agent.serverId);
    await dialog.getByLabel("App", { exact: true }).selectOption("probe");
    await dialog.getByLabel("Version", { exact: true }).selectOption("1.0.0");
    const platzierung = dialog.getByTestId("platzierung");
    await expect(platzierung).toContainText("Passt nicht");
    await expect(platzierung).toContainText("Der Agent des Servers ist nicht verbunden.");
    await ohneBefund(page);
  });

  test("removes a failed setup with a reason", async ({ page }) => {
    const i = await installationAnlegen(page.request, neuerHost("kaputt"));
    try {
      await expect
        .poll(async () => {
          const a = await page.request.get(`/api/v1/installationen/${i.installationId}`);
          return ((await a.json()) as { zustand: string }).zustand;
        })
        .toBe("gescheitert");
      await page.goto(`/apps/${i.installationId}?tab=technik`);
      await expect(page.getByText("Einrichtung gescheitert").first()).toBeVisible();
      await expect(page.getByText("Fehler: image ziehen: manifest unknown")).toBeVisible();
      await page.getByRole("button", { name: "Entfernen …" }).click();
      const dialog = page.getByRole("dialog", { name: `${i.kunde.name} · probe entfernen` });
      await dialog.getByLabel("Grund").fill("Image fehlte, neu anlegen");
      await ohneBefund(page);
      await dialog.getByRole("button", { name: "Entfernen" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Entfernen", { exact: true })).toBeVisible();
    } finally {
      i.agent.trennen();
    }
  });
});
