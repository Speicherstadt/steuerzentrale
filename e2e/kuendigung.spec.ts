import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { tagesbeginn } from "../packages/planung/src/zeit.ts";
import { backups, zielSetzen } from "./hilfen/backups.ts";
import { installationAnlegen, mitBackup, neuerHost } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

type Abwicklung = {
  phase: string;
  schritt: string | null;
  archiv: unknown;
  geloeschtAm: number | null;
};

const abwicklung = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/v1/installationen/${id}/abwicklung`)).json()) as Abwicklung;

const kuendigen = async (request: APIRequestContext, kundeId: string, ende: number) => {
  const antwort = await request.put(`/api/v1/kunden/${kundeId}/kuendigung`, {
    data: { ende, grund: "Kündigung per Mail" },
  });
  expect(antwort.status()).toBe(200);
};

// BAULISTE.md Z-604 against the real Zentrale, the stand-in agent and the stand-in of MinIO: the
// probe app (the example app of the e2e run) with a volume to back up; the contract ends today, so
// the Zentrale has the last backup and the archive made, which the stand-in agent uploads with the
// installation's own access; the operator makes the link with a reason on the installation's page
// and it serves the archive. Then the end moves 90 days back: the Zentrale has the installation
// deleted after a last backup, deletes its repository and S3 access, and the page shows the
// deletion log; the link no longer works. The deadlines themselves and that nothing goes before
// them are tested with a clock in apps/zentrale (modules/abwicklung).
test.describe("contract end", () => {
  test("archive link for the customer, then the deletion after 90 days", async ({ page }) => {
    test.setTimeout(180_000);
    await zielSetzen(page.request);
    const i = await installationAnlegen(page.request, neuerHost("laeuft"), mitBackup());
    await expect
      .poll(async () => (await backups(page.request, i.installationId)).eingerichtet, {
        timeout: 15_000,
      })
      .toBe(true);

    await kuendigen(page.request, i.kunde.id, tagesbeginn(Date.now()));
    await expect
      .poll(async () => (await abwicklung(page.request, i.installationId)).schritt, {
        timeout: 60_000,
      })
      .toBe("warten");

    await page.goto(`/installationen/${i.installationId}`);
    await page.getByRole("tab", { name: "Backups" }).click();
    await expect(page.getByRole("heading", { name: "Vertragsende" })).toBeVisible();
    await expect(page.getByText("1 Dateien")).toBeVisible();
    await page.getByRole("button", { name: "Link für den Kunden" }).click();
    const dialog = page.getByRole("dialog", { name: "Link für den Kunden" });
    await dialog.getByLabel("Grund").fill("Kunde bittet um seine Daten");
    await ohneBefund(page);
    await dialog.getByRole("button", { name: "Link erzeugen" }).click();
    await expect(dialog).toBeHidden();
    const link = page.getByRole("link", { name: /X-Amz-Signature/ });
    await expect(link).toBeVisible();
    const url = (await link.getAttribute("href")) ?? "";
    const archiv = await fetch(url);
    expect(archiv.status).toBe(200);
    expect(await archiv.text()).toBe(`Archiv von ${i.installationId}`);
    await ohneBefund(page);

    // 90 days and more after the end: deleted, after a last backup
    await kuendigen(page.request, i.kunde.id, Date.UTC(2026, 5, 1, 22));
    await expect
      .poll(async () => (await abwicklung(page.request, i.installationId)).schritt, {
        timeout: 120_000,
        intervals: [1000, 2000, 5000],
      })
      .toBe("geloescht");
    expect((await fetch(url)).status).toBe(403);
    await page.reload();
    await page.getByRole("tab", { name: "Backups" }).click();
    await expect(page.getByText(/Gelöscht am/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Löschprotokoll" })).toBeVisible();
    await expect(page.getByText(/repository: \d+ Objekte gelöscht/)).toBeVisible();
    await ohneBefund(page);
  });
});
