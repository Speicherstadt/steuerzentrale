import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { agentVerbinden } from "./hilfen/agent.ts";
import { installationAnlegen, neuerHost } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

// docs/plan.md, "Server und Kunden (Oberfläche 2026-11)", against the real Zentrale with the first
// owner's session: the page "Server" as one table, a server's page with its tabs and the disk over
// time from its facts, a customer's page with its tabs and the availability per month and app.
test.describe("servers and customers", { tag: "@phone" }, () => {
  test("list a server in one table and open its page with its tabs", async ({ page }) => {
    const agent = await agentVerbinden(page.request, "Tabellen-Server", {
      platten: [{ mount: "/", gesamtMb: 1000, freiMb: 600 }],
    });
    try {
      await page.goto("/server");
      const tabelle = page.getByRole("region", { name: "Alle Server" });
      await expect(tabelle.getByRole("columnheader")).toHaveText([
        "Server",
        "Zustand",
        "CPU",
        "RAM",
        "Platte",
        "Apps",
        "System",
      ]);
      const zeile = tabelle.locator("tbody tr").filter({ hasText: agent.name });
      await expect(zeile).toContainText("für mehrere Kunden");
      await expect(zeile).toContainText("40 %");
      await expect(zeile).toContainText("0 Apps");
      await ohneBefund(page);

      await zeile.getByRole("link", { name: agent.name }).click();
      await expect(page).toHaveURL(`/server/${agent.serverId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(agent.name);
      await expect(page.getByRole("tab")).toHaveText([
        "Überblick",
        "Auslastung",
        "Apps 0",
        "Verlauf",
        "Technik",
      ]);
      await expect(page.getByTestId("auslastung")).toContainText("40 %");
      await expect(page.getByTestId("agent")).toContainText("Zertifikat bis");
      await ohneBefund(page);

      await page.getByRole("tab", { name: "Auslastung" }).click();
      await expect(page).toHaveURL(`/server/${agent.serverId}?tab=auslastung`);
      await expect(page.getByTestId("platte-/")).toContainText("40 %");
      // Z-1106: CPU, memory and load as the agent reported them with its facts
      await expect(page.getByTestId("last-cpu")).toContainText("37 %");
      await expect(page.getByTestId("last-ram")).toContainText("50 %");
      await expect(page.getByTestId("last-load")).toContainText("0,8");
      await ohneBefund(page);
    } finally {
      agent.trennen();
    }
  });

  test("open a customer's page with its apps", async ({ page }) => {
    const i = await installationAnlegen(page.request);
    try {
      await page.goto(`/kunden/${i.kunde.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(i.kunde.name);
      await expect(page.getByRole("tab")).toHaveText(["Überblick", "Verlauf"]);
      await expect(page.getByTestId("kunde-apps")).toContainText(i.host);
      await expect(page.getByText(/· Vertrag seit/)).toBeVisible();
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });

  // Z-1201 and Z-1203: services and support accesses are gone, from the menu and as pages; the
  // availability per month stays at the app (Z-704)
  test("find no services and no support accesses, and the availability at the app", async ({
    page,
  }) => {
    const i = await installationAnlegen(page.request, neuerHost("laeuft"));
    try {
      await page.goto("/kunden");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kunden");
      for (const name of ["Support-Zugänge", "Leistungen"])
        await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
      for (const pfad of ["/api/v1/leistungen", "/api/v1/support-zugaenge"])
        expect((await page.request.get(pfad)).status(), pfad).toBe(404);
      for (const pfad of ["/leistungen", "/support"]) {
        await page.goto(pfad);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nicht gefunden");
      }

      await expect
        .poll(async () => {
          const r = await page.request.get(`/api/v1/installationen/${i.installationId}`);
          return ((await r.json()) as { zustand: string }).zustand;
        })
        .toBe("laeuft");
      await page.goto(`/apps/${i.installationId}?tab=technik`);
      await expect(page.getByTestId("verfuegbarkeit")).toContainText("Verfügbarkeit je Monat");
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });
});
