import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { backups, zielSetzen } from "./hilfen/backups.ts";
import {
  installationAnlegen,
  manifestImportieren,
  mitBackupAls,
  neuerHost,
} from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

// An app id no other test installs: the newer version is offered to this spec's installations only
const APP = "aktualisierbar";

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

/** An installation's entry on the page, under its app or among the current ones */
const eintrag = (page: Page, id: string) => page.locator(`li[data-installation="${id}"]`);

type Zeile = {
  installationId: string;
  version: string;
  update: { letzter: { phase: string; fehler: string | null } | null; laeuft: boolean };
};

const zeileVon = async (request: APIRequestContext, id: string) => {
  const antwort = await request.get("/api/v1/updates");
  const { installationen } = (await antwort.json()) as { installationen: Zeile[] };
  return installationen.find((i) => i.installationId === id);
};

/** An installation of version 1.0.0 whose backups are set up, with 1.1.0 imported beside it */
const bereit = async (request: APIRequestContext, host: string) => {
  await zielSetzen(request);
  const i = await installationAnlegen(request, host, mitBackupAls(APP, "1.0.0"));
  await expect
    .poll(async () => (await backups(request, i.installationId)).eingerichtet, { timeout: 15_000 })
    .toBe(true);
  await manifestImportieren(request, mitBackupAls(APP, "1.1.0"));
  return i;
};

// BAULISTE.md Z-503 against the real Zentrale with the first owner's session: an update by hand on
// the page "Updates" with version and reason; the Zentrale backs up first (the stand-in agent,
// e2e/hilfen/agent.ts, reports the run with its snapshot), then sends the update, which the agent
// reports as it ended: held, or rolled back with its reason. The agent's own side (pulling,
// restarting, health, rolling back with the backup) runs in CI against Podman (apps/agent).
test.describe("updates", { tag: "@phone" }, () => {
  test("an update by hand with a reason: backup first, then the new version", async ({ page }) => {
    const i = await bereit(page.request, neuerHost("laeuft"));
    try {
      await page.goto("/updates");
      const zeile = eintrag(page, i.installationId);
      await expect(zeile.locator(`a[href="/installationen/${i.installationId}"]`)).toBeVisible();
      await expect(zeile).toContainText("noch keins");
      await zeile.getByRole("button", { name: `Update für ${i.installationId}` }).click();
      const dialog = page.getByRole("dialog", { name: "Installation aktualisieren?" });
      await expect(dialog.getByRole("note")).toContainText("Vorher wird der Ist-Zustand gesichert");
      await expect(dialog.getByLabel("Version")).toHaveValue("1.1.0");
      await dialog.getByLabel("Grund").fill("Fehlerbehebung laut Hersteller");
      await ohneBefund(page);
      await dialog.getByRole("button", { name: "Aktualisieren" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Update angefordert")).toBeVisible();
      await expect
        .poll(async () => (await zeileVon(page.request, i.installationId))?.update.letzter?.phase)
        .toBe("aktualisiert");
      expect((await zeileVon(page.request, i.installationId))?.version).toBe("1.1.0");
      // the backup of the current state is a run of its own
      expect((await backups(page.request, i.installationId)).laeufe).toHaveLength(1);

      await page.reload();
      // now current: folded away under "Auf dem neuesten Stand"
      const aktuell = page.locator("details").filter({ hasText: "Auf dem neuesten Stand" });
      await aktuell.locator("summary").click();
      const neu = aktuell.locator(`li[data-installation="${i.installationId}"]`);
      await expect(neu).toBeVisible();
      await expect(neu).toContainText("auf 1.1.0 aktualisiert");
      await expect(neu.getByRole("button", { name: /^Update für / })).toHaveCount(0);
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });

  test("a rolled-back update keeps the old version and says why", async ({ page }) => {
    const i = await bereit(page.request, neuerHost("laeuft-zurueck"));
    try {
      const antwort = await page.request.post(`/api/v1/installationen/${i.installationId}/update`, {
        data: { version: "1.1.0", grund: "Test der Rückkehr" },
      });
      expect(antwort.status()).toBe(201);
      await expect
        .poll(async () => (await zeileVon(page.request, i.installationId))?.update.letzter?.phase)
        .toBe("zurueckgenommen");
      expect((await zeileVon(page.request, i.installationId))?.version).toBe("1.0.0");
      await page.goto("/updates");
      const zeile = eintrag(page, i.installationId);
      await expect(zeile.locator(`a[href="/installationen/${i.installationId}"]`)).toBeVisible();
      await expect(zeile).toContainText(
        "1.1.0 zurückgenommen, wieder 1.0.0: Health blieb rot: HTTP 502",
      );
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });
});
