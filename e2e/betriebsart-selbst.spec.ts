import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { agentVerbinden } from "./hilfen/agent.ts";
import { manifestImportieren, neuerHost } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

/** The names in the sidebar, or in the drawer on a phone */
const menue = async (page: Page) => {
  await expect(page.locator("main h1")).toBeVisible();
  const knopf = page.getByRole("button", { name: "Navigation", exact: true });
  if (await knopf.isVisible()) {
    await knopf.click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  }
  const nav = page.getByRole("navigation", { name: "Bereiche" }).filter({ visible: true });
  await expect(nav.getByRole("link", { name: "Apps", exact: true })).toBeVisible();
  return nav;
};

// BAULISTE.md Z-805 on the second Zentrale, whose owner answered "Nur für mich" (e2e/selbst.setup.ts):
// the menu shows neither Kunden nor Support-Zugänge nor Leistungen, and "App installieren" asks for
// no customer; the installation goes to the fixed internal customer
test.describe("Nur für mich", { tag: "@phone" }, () => {
  test("hides customers, support accesses and services in the menu", async ({ page }) => {
    await page.goto("/");
    const nav = await menue(page);
    for (const name of ["Kunden", "Support-Zugänge", "Leistungen"])
      await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Einstellungen" })).toBeVisible();
  });

  test("installs an app without choosing a customer", async ({ page }) => {
    const agent = await agentVerbinden(page.request, "Eigener Server");
    await manifestImportieren(page.request);
    const host = neuerHost("eigen");
    try {
      await page.goto("/apps");
      await page.getByRole("button", { name: "App installieren" }).click();
      const dialog = page.getByRole("dialog", { name: "App installieren" });
      await expect(dialog.getByLabel("Server", { exact: true })).toBeVisible();
      await expect(dialog.getByLabel("Kunde", { exact: true })).toHaveCount(0);
      await dialog.getByLabel("Server", { exact: true }).selectOption(agent.serverId);
      await dialog.getByLabel("App", { exact: true }).selectOption("probe");
      await dialog.getByLabel("Version", { exact: true }).selectOption("1.0.0");
      await expect(dialog.getByTestId("platzierung")).toContainText("Passt");
      await dialog.getByLabel("PROBE_KENNWORT").fill("kennwort-der-installation");
      await dialog.getByLabel("Adresse").fill(host);
      await dialog.getByLabel("Grund").fill("Eigene Buchhaltung");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await dialog.getByRole("button", { name: "Installieren" }).click();
      await expect(dialog).toBeHidden();
      await page.getByRole("searchbox", { name: "Apps suchen" }).fill(host);
      const zeile = page
        .locator("main tbody tr")
        .filter({ has: page.locator("a[href^='/apps/']") });
      await expect(zeile).toHaveCount(1);
      await expect(zeile).toContainText("wird eingerichtet");
      // every app is the operator's own: no column "Kunde"
      await expect(page.getByRole("columnheader", { name: "Kunde" })).toHaveCount(0);
    } finally {
      agent.trennen();
    }
  });

  // docs/plan.md, "Übersicht (Oberfläche 2026-11)": the overview names no customer and no contract
  test("shows the overview without customers", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 2, name: "Zu tun", exact: true }),
    ).toBeVisible();
    const tiles = page.locator("main section").filter({
      has: page.getByRole("heading", { level: 2, name: "Server", exact: true }),
    });
    await expect(tiles).not.toContainText("beim Kunden");
    await expect(page.locator("main")).not.toContainText("gekündigt");
    await expect(page.locator("main")).not.toContainText(/Vertrag .* endet/);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  // the settings in sections, as for customers: the mode of operation says "Nur für mich"
  test("shows the settings in sections, the mode of operation as Nur für mich", async ({
    page,
  }) => {
    await page.goto("/einstellungen?tab=betriebsart");
    const abschnitte = page.getByRole("navigation", { name: "Abschnitte der Einstellungen" });
    await expect(abschnitte.locator('[aria-current="page"]')).toContainText("Betriebsart");
    await expect(page.getByRole("radio", { name: /Nur für mich/ })).toBeChecked();
    await expect(abschnitte.getByRole("link")).toHaveCount(8);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("answers 409 betriebsart where customers are made", async ({ page }) => {
    const antwort = await page.request.post("/api/v1/kunden", {
      data: {
        name: "Fremd",
        kontakt: { name: "F", email: "f@fremd.test" },
        vertrag: { sla: "basis", beginn: Date.UTC(2026, 4, 1, 22) },
        grund: "Test",
      },
    });
    expect(antwort.status()).toBe(409);
    expect(await antwort.json()).toEqual({ fehler: "betriebsart" });
  });
});
