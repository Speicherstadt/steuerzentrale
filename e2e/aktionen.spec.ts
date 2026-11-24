import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { LOG_ZEILEN } from "./hilfen/agent.ts";
import { installationAnlegen, neuerHost, ohneNeustart } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

type Seite = { zustand: string; auftraege: { aktion: string; zustand: string }[] };

const lesen = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/v1/installationen/${id}`)).json()) as Seite;

/** Until the installation runs and every job of it is done */
const laeuft = (request: APIRequestContext, id: string) =>
  expect
    .poll(async () => {
      const s = await lesen(request, id);
      return s.zustand === "laeuft" && s.auftraege.every((a) => a.zustand === "erfolgreich");
    })
    .toBe(true);

// BAULISTE.md Z-405 against the real Zentrale with the first owner's session: restart and log
// excerpt of a running installation, each with a reason; the stand-in agent (e2e/hilfen/agent.ts)
// reports the restart done and sends the lines of the log excerpt, which the dialog then shows. An
// action the manifest does not offer is not on the page. The agent's own side (journald, replacing
// the secrets, refusing what is not offered) runs in CI against Podman (apps/agent).
test.describe("the actions of an installation", { tag: "@phone" }, () => {
  test("restarts with a reason and shows a log excerpt", async ({ page }) => {
    const i = await installationAnlegen(page.request, neuerHost("laeuft"));
    try {
      await laeuft(page.request, i.installationId);
      await page.goto(`/apps/${i.installationId}`);
      await expect(page.getByRole("button", { name: "Nur lesen" })).toHaveCount(0);

      await page.getByRole("button", { name: "Neustart" }).click();
      const neustart = page.getByRole("dialog", { name: "Neustart" });
      await neustart.getByLabel("Grund").fill("Health rot seit 10:31");
      await ohneBefund(page);
      await neustart.getByRole("button", { name: "Ausführen" }).click();
      await expect(neustart).toBeHidden();
      await expect
        .poll(async () => (await lesen(page.request, i.installationId)).auftraege.at(-1))
        .toEqual(
          expect.objectContaining({ aktion: "installation_neustart", zustand: "erfolgreich" }),
        );

      await page.getByRole("button", { name: "Log-Auszug" }).click();
      const log = page.getByRole("dialog", { name: "Log-Auszug" });
      await log.getByLabel("Grund").fill("Anfrage aus dem Portal: Anmeldung langsam");
      await log.getByRole("button", { name: "Anfordern" }).click();
      const zeilen = log.getByRole("region", { name: "Zeilen des Log-Auszugs" });
      for (const zeile of LOG_ZEILEN) await expect(zeilen).toContainText(zeile);
      await expect(log.getByText("3 Zeilen")).toBeVisible();
      await ohneBefund(page);
      await log.getByText("Schließen", { exact: true }).click();
      await expect(log).toBeHidden();
      await expect(
        page.getByRole("listitem").filter({ hasText: "Log-Auszug" }).first(),
      ).toBeVisible();
    } finally {
      i.agent.trennen();
    }
  });

  test("leaves out an action the manifest does not offer", async ({ page }) => {
    const i = await installationAnlegen(page.request, neuerHost("laeuft"), ohneNeustart());
    try {
      await laeuft(page.request, i.installationId);
      await page.goto(`/apps/${i.installationId}`);
      await expect(page.getByRole("button", { name: "Log-Auszug" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Neustart" })).toHaveCount(0);
      const antwort = await page.request.post(
        `/api/v1/installationen/${i.installationId}/neustart`,
        {
          data: { grund: "trotzdem" },
        },
      );
      expect(antwort.status()).toBe(422);
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });
});
