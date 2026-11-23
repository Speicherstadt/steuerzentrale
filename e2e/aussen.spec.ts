import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { installationAnlegen, neuerHost } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

type Monat = { jahr: number; monat: number; gemessen: number; anteil: number | null };
type Aussen = { aussen: unknown; verfuegbarkeit: Monat[] };

const zustand = async (request: APIRequestContext, id: string) =>
  ((await (await request.get(`/api/v1/installationen/${id}`)).json()) as { zustand: string })
    .zustand;

// BAULISTE.md Z-704: a running installation's page has the card of the check from outside with the
// availability per month. The e2e Zentrale checks no address from outside (its hosts are made up,
// STEUERZENTRALE_AUSSEN_PRUEFUNG=aus in playwright.config.ts), so the card says so; the checks
// themselves are proven by Vitest (apps/zentrale/src/modules/aussen).
test.describe("the check from outside", { tag: "@phone" }, () => {
  test("shows on a running installation's page, not yet checked", async ({ page }) => {
    const i = await installationAnlegen(page.request, neuerHost("laeuft"));
    try {
      await expect.poll(() => zustand(page.request, i.installationId)).toBe("laeuft");
      const antwort = await page.request.get(`/api/v1/installationen/${i.installationId}/aussen`);
      expect(antwort.status()).toBe(200);
      const daten = (await antwort.json()) as Aussen;
      expect(daten.aussen).toBeNull();
      expect(daten.verfuegbarkeit).toHaveLength(13);

      await page.goto(`/installationen/${i.installationId}`);
      // the innermost section with the card's heading: the card itself
      const karte = page
        .locator("section", {
          has: page.getByRole("heading", { name: "Adresse und Prüfung von außen" }),
        })
        .last();
      await expect(karte).toContainText("noch nicht von außen geprüft");
      await expect(karte).toContainText(i.host);
      await expect(karte).toContainText("Noch keine Prüfung von außen.");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      i.agent.trennen();
    }
  });
});
