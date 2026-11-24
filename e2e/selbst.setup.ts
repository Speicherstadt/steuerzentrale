import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test as setup } from "@playwright/test";
import { einrichtungscode, PASSWORT, selbstOrdner } from "./hilfen/inhaber.ts";
import { totpCode } from "./hilfen/totp.ts";

setup.use({ locale: "de-DE" });

// BAULISTE.md Z-805 on the second Zentrale (playwright.config.ts): after the first owner and its
// second factor the Zentrale asks "Nur für mich" or "Für Kunden", asks again while unanswered, and
// this owner answers "Nur für mich"; its session is e2e/betriebsart-selbst.spec.ts's
setup('the first owner answers the question with "Nur für mich"', async ({ page }) => {
  await page.goto("/erster-inhaber");
  await page.getByLabel("Einrichtungscode").fill(einrichtungscode(selbstOrdner()));
  await page.getByLabel("Name des Betreibers").fill("Selma Selbst");
  await page.getByLabel("Name", { exact: true }).fill("Selma Selbst");
  await page.getByLabel("E-Mail-Adresse").fill("selma@selbst.test");
  await page.getByLabel("Passwort").fill(PASSWORT);
  await page.getByRole("button", { name: "Einrichten" }).click();
  await expect(page).toHaveURL("/einrichtung");
  await page.getByLabel("Passwort zur Bestätigung").fill(PASSWORT);
  await page.getByRole("button", { name: "Authenticator-App verbinden" }).click();
  const geheimnis = (await page.getByTestId("totp-geheimnis").textContent())?.trim() ?? "";
  await page.getByLabel("Code der Authenticator-App").fill(totpCode(geheimnis));
  await page.getByRole("button", { name: "Code bestätigen" }).click();
  await expect(page.getByRole("status")).toHaveText("Der zweite Faktor ist eingerichtet.");

  await page.getByRole("link", { name: "Zur Übersicht" }).click();
  await expect(page).toHaveURL("/betriebsart");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wofür ist diese Zentrale?");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // unanswered, every page of the shell asks again
  await page.goto("/server");
  await expect(page).toHaveURL("/betriebsart");
  await page.reload();
  await expect(page).toHaveURL("/betriebsart");

  await page.getByRole("button", { name: /^Nur für mich/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
  await page.goto("/server");
  await expect(page).toHaveURL("/server");
  await page.context().storageState({ path: join(selbstOrdner(), "inhaber.json") });
});
