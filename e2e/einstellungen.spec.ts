import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { agentVerbinden } from "./hilfen/agent.ts";
import {
  installationAnlegen,
  manifestDateien,
  mitBetreiberwert,
  neuerHost,
} from "./hilfen/installationen.ts";
import { kundeAnlegen } from "./hilfen/kunden.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

type Seite = {
  zustand: string;
  einstellungen: { installation: Record<string, unknown> };
  auftraege: { aktion: string; zustand: string }[];
};

const lesen = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/v1/installationen/${id}`)).json()) as Seite;

const ZEICHEN = "abcdefghijklmnopqrstuvwxyz";
/** An app id no other run uses: the operator's values belong to the app, in one shared database */
const neueApp = () => `lizenz-${Array.from({ length: 6 }, () => ZEICHEN[randomInt(26)]).join("")}`;

// BAULISTE.md Z-404 against the real Zentrale with the first owner's session: the dialog asks for
// the operator's required value the placement misses and stores it with the installation (a secret,
// shown only as set in the settings), and a running installation is configured anew with a reason;
// the stand-in agent (e2e/hilfen/agent.ts) reports the job done, and the values apply. The agent's
// own side runs in CI against Podman (apps/agent).
test.describe("settings", { tag: "@phone" }, () => {
  test("asks for the operator's missing value in the dialog and keeps it", async ({ page }) => {
    const app = neueApp();
    const kunde = await kundeAnlegen(page.request, "Kanzlei West");
    const agent = await agentVerbinden(page.request, "Gemeinsamer Server");
    const dateien = manifestDateien(mitBetreiberwert(app));
    try {
      await page.goto("/installationen");
      await page.getByRole("button", { name: "App installieren" }).click();
      const dialog = page.getByRole("dialog", { name: "App installieren" });
      await dialog.getByLabel("Kunde", { exact: true }).selectOption(kunde.id);
      await dialog.getByLabel("Server", { exact: true }).selectOption(agent.serverId);
      await dialog.getByLabel("Manifest (manifest.yml)").setInputFiles(dateien.manifest);
      await dialog.getByLabel("Signatur (manifest.yml.minisig)").setInputFiles(dateien.signatur);
      await expect(dialog.getByTestId("platzierung")).toContainText("PROBE_LIZENZ");
      await expect(dialog.getByText("Fehlende Werte des Betreibers")).toBeVisible();
      await dialog.getByLabel("PROBE_LIZENZ").fill("lizenz-aus-dem-dialog");
      await dialog.getByLabel("PROBE_KENNWORT").fill("kennwort-der-installation");
      await dialog.getByLabel("Adresse").fill(neuerHost());
      await dialog.getByLabel("Grund").fill("erste Installation");
      await ohneBefund(page);
      await dialog.getByRole("button", { name: "Installieren" }).click();
      await expect(dialog).toBeHidden();

      const antwort = await page.request.get(`/api/v1/apps/${app}/einstellungen`);
      expect(await antwort.json()).toMatchObject({ gesetzt: ["PROBE_LIZENZ"], werte: {} });
      await page.goto("/einstellungen");
      const karte = page.locator("section", { has: page.getByRole("heading", { name: app }) });
      await expect(karte.getByLabel("PROBE_LIZENZ")).toHaveValue("");
      await expect(karte.getByText(/gesetzt; leer lassen behält den Wert/)).toBeVisible();
      await expect(page.getByText("lizenz-aus-dem-dialog")).toHaveCount(0);
      await ohneBefund(page);
    } finally {
      agent.trennen();
    }
  });

  test("configures a running installation anew with a reason", async ({ page }) => {
    const i = await installationAnlegen(page.request, neuerHost("laeuft"));
    try {
      await expect
        .poll(async () => {
          const s = await lesen(page.request, i.installationId);
          return s.zustand === "laeuft" && s.auftraege.every((a) => a.zustand === "erfolgreich");
        })
        .toBe(true);
      await page.goto(`/installationen/${i.installationId}`);
      await page.getByRole("button", { name: "Einstellungen ändern" }).click();
      const dialog = page.getByRole("dialog", { name: /^Einstellungen von .* ändern$/ });
      await expect(dialog.getByLabel("PROBE_KENNWORT")).toHaveValue("");
      await dialog.getByLabel("PROBE_TITEL").fill("Kanzlei Ost");
      await dialog.getByLabel("Grund").fill("Wunsch des Kunden per Mail");
      await ohneBefund(page);
      await dialog.getByRole("button", { name: "Neu konfigurieren" }).click();
      await expect(dialog).toBeHidden();

      await expect
        .poll(async () => (await lesen(page.request, i.installationId)).einstellungen.installation)
        .toEqual({ PROBE_TITEL: "Kanzlei Ost", PROBE_OFFEN: false });
      const seite = await lesen(page.request, i.installationId);
      expect(seite.auftraege.at(-1)).toMatchObject({
        aktion: "installation_konfigurieren",
        zustand: "erfolgreich",
      });
      await page.reload();
      // the job in the page's list of jobs, not the text of the closed dialog
      await expect(
        page.getByRole("listitem").filter({ hasText: "Neu konfigurieren" }),
      ).toBeVisible();
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });
});
