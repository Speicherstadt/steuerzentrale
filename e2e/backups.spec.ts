import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { installationAnlegen, mitBackup, neuerHost } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

// The admin access the stand-in of MinIO's admin API accepts (apps/zentrale/src/testhilfen/
// minio.ts, TEST_ADMIN and TEST_REGION); the Zentrale of the e2e run talks only to it
// (playwright.config.ts). One target for every run: the projects share one operator, and endpoint
// and bucket stay once an installation has an access there.
const ENDPUNKT = "http://127.0.0.1:28302";
const REGION = "eu-central-1";
const BUCKET = "e2e-backups";
const ADMIN = { accessKey: "minio-admin-e2e", secretKey: "minio-admin-geheim-7c1f9b2e" };

const zielSetzen = async (request: APIRequestContext) => {
  const antwort = await request.put("/api/v1/backup-ziel", {
    data: { endpunkt: ENDPUNKT, region: REGION, bucket: BUCKET, ...ADMIN, grund: "Test" },
  });
  expect(antwort.status()).toBe(200);
};

type Backups = { eingerichtet: boolean; laeufe: { ok: boolean }[] };

const backups = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/v1/installationen/${id}/backups`)).json()) as Backups;

// BAULISTE.md Z-601 against the real Zentrale with the first owner's session: the S3 target with
// its admin access only as set; an installation with a volume to back up gets its own access at the
// stand-in of MinIO and its backups set up by the stand-in agent (e2e/hilfen/agent.ts), then "Backup
// jetzt" with a reason, after which the agent reports a run. The agent's own side (restic, the
// timer, MinIO itself) runs in CI against Podman and MinIO (apps/agent).
test.describe("backups", { tag: "@phone" }, () => {
  test("the S3 target takes the admin access and shows it only as set", async ({ page }) => {
    await page.goto("/einstellungen?tab=backup");
    const karte = page.locator("section", { has: page.getByRole("heading", { name: "Backup" }) });
    await karte.getByLabel("Endpunkt").fill(ENDPUNKT);
    await karte.getByLabel("Region").fill(REGION);
    await karte.getByLabel("Bucket").fill(BUCKET);
    await karte.getByLabel("Access Key des Admins").fill(ADMIN.accessKey);
    await karte.getByLabel("Secret Key des Admins").fill(ADMIN.secretKey);
    await karte.getByLabel("Grund").fill("MinIO beim Betreiber eingerichtet");
    await ohneBefund(page);
    await karte.getByRole("button", { name: "Speichern" }).click();
    await expect(karte.getByText("Backup-Ziel gespeichert.")).toBeVisible();
    await page.reload();
    const neu = page.locator("section", { has: page.getByRole("heading", { name: "Backup" }) });
    await expect(neu.getByLabel("Bucket")).toHaveValue(BUCKET);
    await expect(neu.getByLabel("Secret Key des Admins")).toHaveValue("");
    await expect(neu.getByText("gesetzt; beide leer lassen behält den Zugang")).toBeVisible();
    await expect(page.getByText(ADMIN.secretKey)).toHaveCount(0);
    const antwort = await page.request.get("/api/v1/backup-ziel");
    expect(await antwort.json()).toEqual({
      endpunkt: ENDPUNKT,
      region: REGION,
      bucket: BUCKET,
      zugangGesetzt: true,
    });
    await ohneBefund(page);
  });

  test("Backup jetzt with a reason, and the agent reports the run", async ({ page }) => {
    await zielSetzen(page.request);
    const i = await installationAnlegen(page.request, neuerHost("laeuft"), mitBackup());
    try {
      await expect
        .poll(async () => (await backups(page.request, i.installationId)).eingerichtet, {
          timeout: 15_000,
        })
        .toBe(true);
      await page.goto(`/installationen/${i.installationId}`);
      await page.getByRole("button", { name: "Backup jetzt" }).click();
      const dialog = page.getByRole("dialog", { name: "Backup jetzt" });
      await dialog.getByLabel("Grund").fill("vor dem Update auf 1.1.0");
      await ohneBefund(page);
      await dialog.getByRole("button", { name: "Ausführen" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Backup angefordert")).toBeVisible();
      await expect
        .poll(async () => (await backups(page.request, i.installationId)).laeufe)
        .toEqual([expect.objectContaining({ ok: true })]);

      await page.reload();
      await page.getByRole("tab", { name: "Backups" }).click();
      const laeufe = page.getByRole("region", { name: "Läufe" });
      await expect(laeufe.getByText("erfolgreich")).toBeVisible();
      await expect(laeufe.getByText(/volume-daten: [0-9a-f]{8}/)).toBeVisible();
      await expect(page.getByText("Teile aus dem Manifest: volume daten")).toBeVisible();
      await ohneBefund(page);

      await page.goto("/backups");
      const zeile = page
        .getByRole("row")
        .filter({ has: page.locator(`a[href="/installationen/${i.installationId}"]`) });
      await expect(zeile).toContainText("volume daten");
      await expect(zeile).toContainText("eingerichtet");
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });
});
