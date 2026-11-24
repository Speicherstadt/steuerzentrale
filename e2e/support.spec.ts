import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { installationAnlegen, neuerHost } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

type Zugang = { zugangId: string; grund: string; aktiv: boolean; ende: number; beginn: number };

// BAULISTE.md Z-802 against the real Zentrale with the first owner's session: a support access is
// started on an installation's page with a duration and a reason, shows on the page
// "Support-Zugänge" with its time left and in the installation's events, and ends by hand. That it
// ends by itself and every request after it is refused, the Zentrale's tests prove with a clock
// (apps/zentrale/src/routes/support.test.ts).
test.describe("a support access", { tag: "@phone" }, () => {
  test("is started with a reason, shows and is ended", async ({ page }, info) => {
    const grund = `Anfrage aus dem Portal (${info.project.name}): Anmeldung langsam`;
    const i = await installationAnlegen(page.request, neuerHost("support"));
    try {
      await page.goto(`/apps/${i.installationId}?tab=technik`);
      await expect(page.getByText("Support erreicht Log-Auszug und Neustart nur")).toBeVisible();
      await page.getByRole("button", { name: "Zugang starten" }).click();
      const starten = page.getByRole("dialog", { name: "Support-Zugang starten" });
      await expect(starten.getByLabel("Dauer")).toHaveValue("120");
      await starten.getByLabel("Grund").fill(grund);
      await ohneBefund(page);
      await starten.getByRole("button", { name: "Zugang starten" }).click();
      await expect(starten).toBeHidden();
      await expect(page.getByText(`Ihr Zugang läuft noch 120 Min.: „${grund}“`)).toBeVisible();

      const antwort = await page.request.get(
        `/api/v1/support-zugaenge?installationId=${i.installationId}`,
      );
      const { zugaenge } = (await antwort.json()) as { zugaenge: Zugang[] };
      expect(zugaenge).toEqual([expect.objectContaining({ grund, aktiv: true })]);
      expect((zugaenge[0]?.ende ?? 0) - (zugaenge[0]?.beginn ?? 0)).toBe(2 * 3_600_000);

      await page.getByRole("tab", { name: "Verlauf" }).click();
      await expect(page.getByText(`„${grund}“`).first()).toBeVisible();

      await page.goto("/support");
      await expect(page.getByText(grund)).toBeVisible();
      await ohneBefund(page);

      await page.goto(`/apps/${i.installationId}?tab=technik`);
      await page.getByRole("button", { name: "Zugang beenden" }).click();
      await expect(page.getByRole("button", { name: "Zugang starten" })).toBeVisible();
      const danach = (await (
        await page.request.get(`/api/v1/support-zugaenge?installationId=${i.installationId}`)
      ).json()) as { zugaenge: Zugang[] };
      expect(danach.zugaenge).toEqual([expect.objectContaining({ grund, aktiv: false })]);
    } finally {
      i.agent.trennen();
    }
  });
});
