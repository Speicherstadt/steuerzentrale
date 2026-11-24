import { writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test as setup } from "@playwright/test";
import {
  einrichtungscode,
  INHABER_EMAIL,
  PASSWORT,
  sitzungsDatei,
  zugangsDatei,
} from "./hilfen/inhaber.ts";
import { totpCode } from "./hilfen/totp.ts";

setup.use({ locale: "de-DE" });

// BAULISTE.md Z-104: the first owner comes in with the setup code from the log, sets up TOTP with
// the QR code's key, and only then reaches the shell
setup("the first owner sets up the Zentrale with the code from the log", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/anmelden");

  await page.goto("/erster-inhaber");
  await page.getByLabel("Einrichtungscode").fill(einrichtungscode());
  await page.getByLabel("Name des Betreibers").fill("Teufel IT");
  await page.getByLabel("Name", { exact: true }).fill("Ines Inhaber");
  await page.getByLabel("E-Mail-Adresse").fill(INHABER_EMAIL);
  await page.getByLabel("Passwort").fill(PASSWORT);
  await page.getByRole("button", { name: "Einrichten" }).click();
  await expect(page).toHaveURL("/einrichtung");

  // without the second factor the shell sends back to the setup
  await page.goto("/server");
  await expect(page).toHaveURL("/einrichtung");

  await page.getByLabel("Passwort zur Bestätigung").fill(PASSWORT);
  await page.getByRole("button", { name: "Authenticator-App verbinden" }).click();
  await expect(page.getByRole("img", { name: "QR-Code für die Authenticator-App" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const geheimnis = (await page.getByTestId("totp-geheimnis").textContent())?.trim() ?? "";
  await page.getByLabel("Code der Authenticator-App").fill(totpCode(geheimnis));
  await page.getByRole("button", { name: "Code bestätigen" }).click();
  await expect(page.getByRole("status")).toHaveText("Der zweite Faktor ist eingerichtet.");

  // Z-805: the question "Nur für mich" or "Für Kunden" comes before the shell; this Zentrale hosts
  // for customers, as every other spec expects (the other answer: e2e/selbst.setup.ts)
  await page.getByRole("link", { name: "Zur Übersicht" }).click();
  await expect(page).toHaveURL("/betriebsart");
  await page.getByRole("button", { name: /^Für Kunden/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
  await page.context().storageState({ path: sitzungsDatei() });
  writeFileSync(zugangsDatei(), JSON.stringify({ geheimnis }));
});
