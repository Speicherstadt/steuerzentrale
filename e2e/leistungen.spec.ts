import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installationAnlegen, neuerHost } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

// BAULISTE.md Z-804 against the real Zentrale with the first owner's session: an installation whose
// setup succeeded counts for its customer in the month; the page shows the row and downloads the
// month as CSV. The sums from runs, accesses and checks the Zentrale's tests prove with a clock
// (apps/zentrale/src/routes/leistungen.test.ts, packages/planung/src/leistungen.test.ts).
test.describe("the services", { tag: "@phone" }, () => {
  test("show a customer's installation and download the month as CSV", async ({ page }) => {
    const i = await installationAnlegen(page.request, neuerHost("laeuft"));
    try {
      await expect
        .poll(async () => {
          const a = await page.request.get(`/api/v1/installationen/${i.installationId}`);
          return ((await a.json()) as { zustand: string }).zustand;
        })
        .toBe("laeuft");
      await page.goto("/leistungen");
      const zeile = page.getByRole("row").filter({ hasText: i.kunde.name });
      await expect(zeile).toBeVisible();
      await expect(zeile.getByText("probe")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      const laden = page.waitForEvent("download");
      await page.getByRole("link", { name: "CSV herunterladen" }).click();
      const datei = await laden;
      expect(datei.suggestedFilename()).toMatch(/^leistungen-\d{4}-\d{2}\.csv$/);
      const text = await readFile((await datei.path()) ?? "", "utf8");
      const zeilen = text.split("\r\n");
      expect(zeilen[0]).toBe(
        "monat,kunde,kuerzel,installationen,apps,speicher_bytes,support_minuten,verfuegbarkeit_prozent,gemessene_minuten,minuten",
      );
      expect(zeilen.at(-1)).toBe("");
      expect(zeilen.find((z) => z.includes(i.kunde.name))).toMatch(/,1,probe,/);
    } finally {
      i.agent.trennen();
    }
  });
});
