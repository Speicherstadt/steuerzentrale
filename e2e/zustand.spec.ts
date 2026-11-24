import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import type { ZustandEintrag } from "./hilfen/agent.ts";
import { installationAnlegen, neuerHost } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

type Antwort = { zustand: string; health: { zustand: string } };

const lesen = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/v1/installationen/${id}`)).json()) as Antwort;

// BAULISTE.md Z-403: the stand-in agent (e2e/hilfen/agent.ts) finishes the setup of a `laeuft…`
// host and reports the state the test gives it; the Zentrale rates it and the pages show state,
// reason and history. The Zentrale takes one report per connection every 5 s, so each report is
// sent again until it arrived.
test.describe("the state of an installation", { tag: "@phone" }, () => {
  test("shows the agent's report with reason and history", async ({ page }) => {
    const i = await installationAnlegen(page.request, neuerHost("laeuft"));
    const eintrag = (health: "gruen" | "rot", aktiv: string, grund: string): ZustandEintrag => ({
      installationId: i.installationId,
      units: [{ name: `${i.installationId}-app.service`, aktiv }],
      health: { zustand: health, grund },
    });
    const melden = async (e: ZustandEintrag) =>
      expect
        .poll(
          async () => {
            i.agent.melden([e]);
            return (await lesen(page.request, i.installationId)).health.zustand;
          },
          { intervals: [500, 1000], timeout: 20_000 },
        )
        .toBe(e.health.zustand);
    try {
      await expect
        .poll(async () => (await lesen(page.request, i.installationId)).zustand)
        .toBe("laeuft");
      await melden(eintrag("gruen", "active", "HTTP 200"));
      await melden(eintrag("rot", "failed", "HTTP 503"));

      await page.goto("/apps");
      const zeile = page
        .locator("tbody tr")
        .filter({ has: page.locator(`a[href="/apps/${i.installationId}"]`) });
      await expect(zeile).toContainText("Störung: Health: HTTP 503");

      await zeile.getByRole("link").click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`probe · ${i.kunde.name}`);
      await expect(page.getByText("Störung: Health: HTTP 503")).toBeVisible();
      await page.getByRole("tab", { name: "Technik" }).click();
      const health = page.getByTestId("health");
      await expect(health).toContainText("Health: HTTP 503 · seit");
      await expect(health).toContainText("Rot");
      await expect(page.getByText(`${i.installationId}-app.service`)).toBeVisible();
      await expect(page.getByText("systemd: failed")).toBeVisible();
      await page.getByRole("tab", { name: "Verlauf" }).click();
      const verlauf = page.getByTestId("verlauf").getByRole("listitem");
      await expect(verlauf).toHaveCount(2);
      await expect(verlauf.nth(0)).toContainText("Rot");
      await expect(verlauf.nth(0)).toContainText("Health: HTTP 503");
      await expect(verlauf.nth(1)).toContainText("Grün");
      await expect(verlauf.nth(1)).toContainText("Health: HTTP 200");
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });
});
