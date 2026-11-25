import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { mailInhalt, smtpNachbau } from "../apps/zentrale/src/testhilfen/smtp.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

// BAULISTE.md Z-703 against the real Zentrale with the first owner's session: the mail server set in
// the tab "Benachrichtigungen" (a stand-in SMTP server on localhost, apps/zentrale/src/testhilfen/
// smtp.ts, plain as only a relay on the Zentrale's own machine may be), a mail recipient that gets
// a test message through it, a webhook whose path and key never show again, and the removal with a
// reason. Desktop only: the operator's mail server is one, and a run on the phone beside it would
// point it at its own stand-in.
test.describe("notifications", () => {
  test("go to a recipient through the mail server set here, and no secret shows", async ({
    page,
  }) => {
    const smtp = await smtpNachbau();
    const adresse = `betrieb-${randomUUID().slice(0, 8)}@betreiber.test`;
    try {
      await page.goto("/einstellungen?tab=melden");
      const versand = page.locator("section", {
        has: page.getByRole("heading", { name: "Benachrichtigungen" }),
      });
      await versand.getByLabel("SMTP-Server").fill("127.0.0.1");
      await versand.getByLabel("Port").fill(String(smtp.port));
      await versand.getByLabel("Verschlüsselung").selectOption("keine");
      await versand.getByLabel("Absender").fill("zentrale@betreiber.test");
      await versand.getByLabel("Ruhezeit von").fill("22:00");
      await versand.getByLabel("Ruhezeit bis").fill("07:00");
      await expect(versand.getByLabel("Grund")).toHaveCount(0);
      await versand.getByRole("button", { name: "Speichern" }).click();
      await expect(page.getByText("Benachrichtigungen gespeichert.")).toBeVisible();

      await page.getByRole("button", { name: "Empfänger hinzufügen" }).click();
      const dialog = page.getByRole("dialog", { name: "Empfänger hinzufügen" });
      await dialog.getByLabel("Empfänger", { exact: true }).fill(adresse);
      await dialog.getByLabel("Ab Schwere").selectOption("fehler");
      await expect(dialog.getByLabel("Grund")).toHaveCount(0);
      await ohneBefund(page);
      await dialog.getByRole("button", { name: "Empfänger hinzufügen" }).click();
      await expect(dialog).toBeHidden();

      await page.getByRole("button", { name: `Test senden an ${adresse}` }).click();
      await expect(page.getByText(`Testnachricht an ${adresse} zugestellt.`)).toBeVisible();
      const mail = smtp.empfangen.find((m) => m.an.includes(adresse));
      expect(mail?.von).toBe("zentrale@betreiber.test");
      expect(mailInhalt(mail?.daten ?? "").text).toContain("Testnachricht der Steuerzentrale");

      await page.getByRole("button", { name: "Empfänger hinzufügen" }).click();
      await dialog.getByLabel("Art").selectOption("webhook");
      const schluessel = await dialog.getByLabel("Signierschlüssel").inputValue();
      expect(schluessel).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await dialog.getByLabel("URL des Webhooks").fill("https://hooks.e2e.example/geheimer-pfad");
      await expect(dialog.getByLabel("Grund")).toHaveCount(0);
      await dialog.getByRole("button", { name: "Empfänger hinzufügen" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("https://hooks.e2e.example").first()).toBeVisible();
      await page.reload();
      await expect(page.getByText(adresse).first()).toBeVisible();
      await expect(page.locator("body")).not.toContainText("geheimer-pfad");
      await expect(page.locator("body")).not.toContainText(schluessel);
      await ohneBefund(page);

      await page.getByRole("button", { name: `${adresse} entfernen` }).click();
      const weg = page.getByRole("dialog", { name: "Empfänger entfernen" });
      await expect(weg.getByLabel("Grund")).toHaveCount(0);
      await weg.getByRole("button", { name: "Entfernen" }).click();
      await expect(weg).toBeHidden();
      await expect(page.getByText("Empfänger entfernt.")).toBeVisible();
      await expect(page.getByRole("region", { name: "Empfänger" })).not.toContainText(adresse);
    } finally {
      await smtp.stoppen();
    }
  });
});
