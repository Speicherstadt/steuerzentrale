import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

test.use({ locale: "de-DE" });

/** No finding of axe on the page as it stands, an open dialog included */
const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

// BAULISTE.md Z-801: customers are created, changed and given a notice date in their dialogs, each
// with a reason, against the real Zentrale with the first owner's session (e2e/einrichtung.setup.ts)
test.describe("customers", { tag: "@phone" }, () => {
  test("are created, changed and given notice", async ({ page }, info) => {
    const name = `Muster Design ${info.project.name} ${randomUUID().slice(0, 8)}`;
    await page.goto("/kunden");
    await page.getByRole("button", { name: "Kunde anlegen" }).click();
    const anlegen = page.getByRole("dialog", { name: "Kunde anlegen" });
    await expect(anlegen).toBeVisible();
    await ohneBefund(page);
    await anlegen.getByLabel("Name des Kunden").fill(name);
    await anlegen.getByLabel("Ansprechperson").fill("Mia Muster");
    await anlegen.getByLabel("E-Mail-Adresse").fill("mia@muster-design.test");
    await anlegen.getByLabel("Telefon").fill("+49 40 5550199");
    await anlegen.getByLabel("Vertragsbeginn").fill("2026-12-01");
    await anlegen.getByLabel("Grund").fill("Vertrag vom 20.11.");
    await anlegen.getByRole("button", { name: "Anlegen" }).click();
    await expect(page).toHaveURL(/\/kunden\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByText("· Basis-Vertrag seit 01.12.2026")).toBeVisible();
    await expect(page.getByTestId("kunde-apps")).toContainText("noch keine App");
    await expect(page.getByText("mia@muster-design.test")).toBeVisible();

    await page.getByRole("button", { name: "Ändern" }).click();
    const aendern = page.getByRole("dialog", { name: `${name} ändern` });
    await expect(aendern.getByLabel("Ansprechperson")).toHaveValue("Mia Muster");
    await aendern.getByLabel("Ansprechperson").fill("Max Muster");
    await aendern.getByLabel("Grund").fill("neue Ansprechperson");
    await aendern.getByRole("button", { name: "Speichern" }).click();
    await expect(aendern).toBeHidden();
    await expect(page.getByText("Max Muster")).toBeVisible();

    await page.getByRole("button", { name: "Mehr …" }).click();
    await page.getByRole("menuitem", { name: "Kündigen …" }).click();
    const kuendigen = page.getByRole("dialog", { name: `${name} kündigen` });
    await kuendigen.getByLabel("Vertragsende").fill("2027-01-31");
    await expect(kuendigen.getByText("Löschung am 01.05.2027")).toBeVisible();
    await kuendigen.getByLabel("Grund").fill("Kündigung per Mail vom 20.11.");
    await ohneBefund(page);
    await kuendigen.getByRole("button", { name: "Kündigung eintragen" }).click();
    await expect(kuendigen).toBeHidden();
    await expect(page.getByText("Gekündigt zum 31.01.2027")).toBeVisible();
    await ohneBefund(page);

    // after a reload too: the Zentrale keeps it
    await page.goto("/kunden");
    await page.getByRole("searchbox", { name: "Kunden suchen" }).fill(name);
    const zeile = page.getByRole("region", { name: "Alle Kunden" }).locator("tbody tr");
    await expect(zeile).toHaveCount(1);
    await expect(zeile).toContainText("Gekündigt zum 31.01.2027");
    await zeile.getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  });

  test("take a notice back with a reason", async ({ page }, info) => {
    const name = `Café ${info.project.name} ${randomUUID().slice(0, 8)}`;
    const antwort = await page.request.post("/api/v1/kunden", {
      data: {
        name,
        kontakt: { name: "Clara", email: "cafe@cafe.test" },
        vertrag: { sla: "basis", beginn: Date.UTC(2026, 0, 10, 23) },
        grund: "Test",
      },
    });
    const { id } = (await antwort.json()) as { id: string };
    await page.request.put(`/api/v1/kunden/${id}/kuendigung`, {
      data: { ende: Date.UTC(2026, 10, 29, 23), grund: "Test" },
    });
    await page.goto(`/kunden/${id}`);
    await expect(page.getByText("Gekündigt zum 30.11.2026")).toBeVisible();
    await page.getByRole("button", { name: "Kündigung zurücknehmen" }).click();
    const dialog = page.getByRole("dialog", { name: `Kündigung von ${name} zurücknehmen` });
    await expect(dialog.getByText("die Löschung am 28.02.2027 entfällt")).toBeVisible();
    await dialog.getByLabel("Grund").fill("Kunde bleibt, Mail vom 20.11.");
    await dialog.getByRole("button", { name: "Kündigung zurücknehmen" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Gekündigt zum")).toHaveCount(0);
    await page.getByRole("button", { name: "Mehr …" }).click();
    await expect(page.getByRole("menuitem", { name: "Kündigen …" })).toBeVisible();
  });

  test("show an unknown id as not found", async ({ page }) => {
    await page.goto(`/kunden/${randomUUID()}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nicht gefunden");
  });
});
