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
  await expect(nav.getByRole("link", { name: "Installationen" })).toBeVisible();
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
      await page.goto("/installationen");
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
      await expect(page.locator("tbody tr, li", { hasText: host }).first()).toContainText(
        "wird eingerichtet",
      );
    } finally {
      agent.trennen();
    }
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
