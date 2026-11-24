import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN, BUCKET, backups, ENDPUNKT, REGION, zielSetzen } from "./hilfen/backups.ts";
import { installationAnlegen, mitBackup, neuerHost } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

// BAULISTE.md Z-601 against the real Zentrale with the first owner's session: the S3 target with
// its admin access only as set; an installation with a volume to back up gets its own access at the
// stand-in of MinIO and its backups set up by the stand-in agent (e2e/hilfen/agent.ts), then "Backup
// jetzt" with a reason, after which the agent reports a run; then "Prüf-Restore jetzt" (Z-602), whose
// result the agent reports and the page shows; then restoring a chosen run (Z-603): the backup of
// the current state and the restore, both reported done by the agent. The agent's own side (restic,
// the timer, the copy, playing back, MinIO itself) runs in CI against Podman and MinIO (apps/agent).
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

  test("Backup jetzt and Prüf-Restore jetzt; the page shows what the agent reports", async ({
    page,
  }) => {
    await zielSetzen(page.request);
    const i = await installationAnlegen(page.request, neuerHost("laeuft"), mitBackup());
    try {
      await expect
        .poll(async () => (await backups(page.request, i.installationId)).eingerichtet, {
          timeout: 15_000,
        })
        .toBe(true);
      await page.goto(`/apps/${i.installationId}`);
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
      await expect(laeufe.getByText(/volume:daten: [0-9a-f]{8}/)).toBeVisible();
      await expect(page.getByText("Teile aus dem Manifest: volume daten")).toBeVisible();
      await ohneBefund(page);

      await page.goto("/backups");
      const zeile = page
        .getByRole("row")
        .filter({ has: page.locator(`a[href="/apps/${i.installationId}"]`) });
      await expect(zeile).toContainText("volume daten");
      await expect(zeile).toContainText("eingerichtet");
      await ohneBefund(page);

      await page.goto(`/apps/${i.installationId}`);
      await page.getByRole("button", { name: "Mehr …" }).click();
      await page.getByRole("menuitem", { name: "Prüf-Restore jetzt" }).click();
      const pruef = page.getByRole("dialog", { name: "Prüf-Restore jetzt" });
      await pruef.getByLabel("Grund").fill("nach dem Wechsel des S3-Ziels");
      await ohneBefund(page);
      await pruef.getByRole("button", { name: "Ausführen" }).click();
      await expect(pruef).toBeHidden();
      await expect(page.getByText("Prüf-Restore angefordert")).toBeVisible();
      await expect
        .poll(async () => (await backups(page.request, i.installationId)).pruefRestore.letzter)
        .toEqual(expect.objectContaining({ ok: true }));

      await page.reload();
      await page.getByRole("tab", { name: "Backups" }).click();
      await expect(page.getByText(/, gelungen$/)).toBeVisible();
      // the restored part with its snapshot, beside the runs' table
      await expect(page.locator("dd").getByText(/^volume:daten: [0-9a-f]{8}$/)).toBeVisible();
      await expect(page.getByText("42 s")).toBeVisible();
      await ohneBefund(page);

      await page.goto("/backups");
      await expect(
        page.getByRole("row").filter({ has: page.locator(`a[href="/apps/${i.installationId}"]`) }),
      ).toContainText(", gelungen");
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });

  test("a run is chosen and restored, after a backup of the current state", async ({ page }) => {
    await zielSetzen(page.request);
    const i = await installationAnlegen(page.request, neuerHost("laeuft"), mitBackup());
    try {
      const id = i.installationId;
      await expect
        .poll(async () => (await backups(page.request, id)).eingerichtet, { timeout: 15_000 })
        .toBe(true);
      const jetzt = await page.request.post(`/api/v1/installationen/${id}/backup`, {
        data: { grund: "erster Lauf" },
      });
      expect(jetzt.status()).toBe(201);
      await expect.poll(async () => (await backups(page.request, id)).laeufe).toHaveLength(1);
      // no job of the installation open any more: its backup's result arrived after the run
      await expect
        .poll(async () => {
          const seite = await page.request.get(`/api/v1/installationen/${id}`);
          const { auftraege } = (await seite.json()) as { auftraege: { zustand: string }[] };
          return auftraege.every((a) => ["erfolgreich", "gescheitert"].includes(a.zustand));
        })
        .toBe(true);

      await page.goto(`/apps/${id}`);
      await page.getByRole("tab", { name: "Backups" }).click();
      const laeufe = page.getByRole("region", { name: "Läufe" });
      await laeufe.getByRole("button", { name: /^Lauf vom .+ wiederherstellen$/ }).click();
      const dialog = page.getByRole("dialog", { name: "Lauf wiederherstellen?" });
      await expect(dialog.getByRole("note")).toContainText("Vorher wird der Ist-Zustand gesichert");
      await dialog.getByLabel("Grund").fill("Auftrag des Kunden vom 20.11.");
      await ohneBefund(page);
      await dialog.getByRole("button", { name: "Wiederherstellen" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Wiederherstellen angefordert")).toBeVisible();
      await expect
        .poll(async () => (await backups(page.request, id)).wiederherstellen.letzter?.phase)
        .toBe("gelungen");
      // the backup of the current state is a run of its own
      expect((await backups(page.request, id)).laeufe).toHaveLength(2);

      await page.reload();
      await page.getByRole("tab", { name: "Backups" }).click();
      await expect(page.getByText(/, gelungen: Stand /)).toBeVisible();
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });
});
