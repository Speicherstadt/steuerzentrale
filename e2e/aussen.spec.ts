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

      await page.goto(`/apps/${i.installationId}?tab=technik`);
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

      // the bars of the tab Messwerte: 90 days, none measured yet, so every one grey
      const tage = await page.request.get(
        `/api/v1/installationen/${i.installationId}/verfuegbarkeit`,
      );
      expect(((await tage.json()) as { tage: unknown[] }).tage).toHaveLength(90);
      await page.getByRole("tab", { name: "Messwerte" }).click();
      const balken = page.getByTestId("tagesbalken").locator("span");
      await expect(balken).toHaveCount(90);
      await expect(page.getByTestId("tagesbalken").locator('span[data-ton="leer"]')).toHaveCount(
        90,
      );
      await expect(page.getByTestId("mess-hinweis")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      i.agent.trennen();
    }
  });
});
