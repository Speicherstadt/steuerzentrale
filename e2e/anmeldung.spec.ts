import { randomUUID } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { INHABER_EMAIL, PASSWORT, totpSchluesselDesInhabers } from "./hilfen/inhaber.ts";
import { totpCode } from "./hilfen/totp.ts";

test.use({ locale: "de-DE" });

const OHNE_SITZUNG = { storageState: { cookies: [], origins: [] } };

/** An invitation link of the first owner (its session is the project's storageState) */
const einladungsLink = async (page: Page, rolle: string): Promise<string> => {
  const antwort = await page.request.post("/api/v1/einladungen", { data: { rolle } });
  expect(antwort.status()).toBe(201);
  const { link } = (await antwort.json()) as { link: string };
  return new URL(link).hash;
};

/** A virtual platform authenticator over CDP (Chromium's WebAuthn domain), as a phone or laptop has */
const mitAuthenticator = async (context: BrowserContext, page: Page) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
};

// BAULISTE.md Z-104: sign-in with a passkey and with password and TOTP
test.describe("signing in", { tag: "@phone" }, () => {
  test("with password and TOTP leads to the overview", async ({ browser }) => {
    const context = await browser.newContext(OHNE_SITZUNG);
    const page = await context.newPage();
    await page.goto("/kunden");
    await expect(page).toHaveURL("/anmelden");
    await page.getByLabel("E-Mail-Adresse").fill(INHABER_EMAIL);
    await page.getByLabel("Passwort").fill(PASSWORT);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await page.getByLabel("Code der Authenticator-App").fill(totpCode(totpSchluesselDesInhabers()));
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
    await context.close();
  });

  test("refuses a wrong password", async ({ browser }) => {
    const context = await browser.newContext(OHNE_SITZUNG);
    const page = await context.newPage();
    await page.goto("/anmelden");
    await page.getByLabel("E-Mail-Adresse").fill(INHABER_EMAIL);
    await page.getByLabel("Passwort").fill("falsch-falsch-falsch");
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(/stimmt nicht|Zu viele Versuche/);
    await expect(page).toHaveURL("/anmelden");
    await context.close();
  });

  test("with a passkey, after accepting an invitation without a password", async ({
    browser,
    page,
  }, info) => {
    const hash = await einladungsLink(page, "technik");
    const context = await browser.newContext(OHNE_SITZUNG);
    const neu = await context.newPage();
    await mitAuthenticator(context, neu);
    await neu.goto(`/einladung${hash}`);
    await expect(neu.getByText("Teufel IT lädt in die Steuerzentrale ein")).toBeVisible();
    await neu.getByLabel("Name", { exact: true }).fill("Tom Technik");
    await neu
      .getByLabel("E-Mail-Adresse")
      .fill(`tom-${info.project.name}-${randomUUID()}@betreiber.test`);
    await neu.getByRole("button", { name: "Konto anlegen" }).click();
    await expect(neu).toHaveURL("/einrichtung");

    await neu.getByRole("button", { name: "Passkey anlegen" }).click();
    await expect(neu.getByRole("status")).toHaveText("Der zweite Faktor ist eingerichtet.");
    await neu.getByRole("button", { name: "Abmelden" }).click();
    await expect(neu).toHaveURL("/anmelden");

    await neu.getByRole("button", { name: "Mit Passkey anmelden" }).click();
    await expect(neu.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
    await context.close();
  });
});

test.describe("an account without a second factor", () => {
  test("reaches only the setup", async ({ browser, page }) => {
    const hash = await einladungsLink(page, "support");
    const context = await browser.newContext(OHNE_SITZUNG);
    const neu = await context.newPage();
    await neu.goto(`/einladung${hash}`);
    await neu.getByLabel("Name", { exact: true }).fill("Sina Support");
    await neu.getByLabel("E-Mail-Adresse").fill(`sina-${randomUUID()}@betreiber.test`);
    await neu.getByLabel("Passwort").fill(PASSWORT);
    await neu.getByRole("button", { name: "Konto anlegen" }).click();
    await expect(neu).toHaveURL("/einrichtung");
    for (const pfad of ["/", "/server", "/einstellungen"]) {
      await neu.goto(pfad);
      await expect(neu).toHaveURL("/einrichtung");
    }
    expect((await neu.request.get("/api/v1/mitglieder")).status()).toBe(403);
    await context.close();
  });
});

test.describe("the setup code", () => {
  test("is no longer asked for once the Zentrale is set up", async ({ page }) => {
    await page.goto("/erster-inhaber");
    await expect(page.getByText("Die Zentrale ist schon eingerichtet.")).toBeVisible();
    await expect(page.getByLabel("Einrichtungscode")).toHaveCount(0);
  });
});
