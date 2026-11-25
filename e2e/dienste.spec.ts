import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

test.use({ locale: "de-DE" });

/** No finding of axe on the page as it stands, an open dialog included */
const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

// BAULISTE.md Z-1101: an observed service is added, changed and removed on the page "Apps" by the
// owner, against the real Zentrale with the first owner's session (e2e/einrichtung.setup.ts); the
// check from outside is off in the E2E Zentrale (playwright.config.ts), so it stays unchecked
test.describe("observed services", { tag: "@phone" }, () => {
  test("are added, changed and removed", async ({ page }, info) => {
    const name = `Wiki ${info.project.name} ${randomUUID().slice(0, 8)}`;
    await page.goto("/apps");
    await page.getByRole("button", { name: "Dienst beobachten" }).click();
    const anlegen = page.getByRole("dialog", { name: "Dienst beobachten" });
    await expect(anlegen).toBeVisible();
    await ohneBefund(page);
    await anlegen.getByLabel("Name", { exact: true }).fill(name);
    await anlegen.getByLabel("Adresse", { exact: true }).fill("https://wiki.e2e.test");
    await anlegen.getByLabel("Pfad der Health-Prüfung").fill("/health");
    await anlegen.getByRole("button", { name: "Beobachten" }).click();
    await expect(anlegen).toBeHidden();

    const tabelle = page.getByRole("region", { name: "Beobachtete Dienste" });
    const zeile = tabelle.locator("tbody tr", { hasText: name });
    await expect(zeile).toHaveCount(1);
    await expect(zeile).toContainText("beobachtet");
    await expect(zeile).toContainText("wiki.e2e.test/health");
    await expect(zeile).toContainText("Noch nicht geprüft");
    await ohneBefund(page);

    await zeile.getByRole("button", { name: `${name} ändern` }).click();
    const aendern = page.getByRole("dialog", { name: "Dienst ändern" });
    await expect(aendern.getByLabel("Adresse", { exact: true })).toHaveValue(
      "https://wiki.e2e.test",
    );
    await aendern.getByLabel("Name", { exact: true }).fill(`${name} intern`);
    await aendern.getByLabel("Pfad der Health-Prüfung").fill("/");
    await aendern.getByRole("button", { name: "Speichern" }).click();
    await expect(aendern).toBeHidden();
    const geaendert = tabelle.locator("tbody tr", { hasText: `${name} intern` });
    await expect(geaendert).toHaveCount(1);
    await expect(geaendert).not.toContainText("/health");

    // after a reload too: the Zentrale keeps it
    await page.reload();
    await expect(geaendert).toHaveCount(1);

    await geaendert.getByRole("button", { name: `${name} intern entfernen` }).click();
    const entfernen = page.getByRole("dialog", { name: `${name} intern nicht mehr beobachten?` });
    await ohneBefund(page);
    await entfernen.getByRole("button", { name: "Entfernen" }).click();
    await expect(entfernen).toBeHidden();
    await expect(tabelle.locator("tbody tr", { hasText: name })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Dienst beobachten" })).toBeVisible();
    await expect(tabelle.locator("tbody tr", { hasText: name })).toHaveCount(0);
  });

  test("refuses an address with a path", async ({ page }) => {
    await page.goto("/apps");
    await page.getByRole("button", { name: "Dienst beobachten" }).click();
    const anlegen = page.getByRole("dialog", { name: "Dienst beobachten" });
    await anlegen.getByLabel("Name", { exact: true }).fill("Falsch");
    const adresse = anlegen.getByLabel("Adresse", { exact: true });
    await adresse.fill("https://wiki.e2e.test/health");
    await anlegen.getByRole("button", { name: "Beobachten" }).click();
    // the browser stops it at the field's pattern, before the Zentrale says 400
    await expect(anlegen).toBeVisible();
    expect(await adresse.evaluate((e) => (e as HTMLInputElement).validity.patternMismatch)).toBe(
      true,
    );
  });
});
