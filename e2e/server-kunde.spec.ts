import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { agentVerbinden } from "./hilfen/agent.ts";
import { installationAnlegen } from "./hilfen/installationen.ts";

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
      await expect(page.getByTestId("last-hinweis")).toHaveText(
        "CPU und Arbeitsspeicher kommen, sobald der Agent sie meldet.",
      );
      await ohneBefund(page);
    } finally {
      agent.trennen();
    }
  });

  test("open a customer's page with its apps, support and services", async ({ page }) => {
    const i = await installationAnlegen(page.request);
    try {
      await page.goto(`/kunden/${i.kunde.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(i.kunde.name);
      await expect(page.getByRole("tab")).toHaveText([
        "Überblick",
        "Support",
        "Leistungen",
        "Verlauf",
      ]);
      await expect(page.getByTestId("kunde-apps")).toContainText(i.host);
      await expect(page.getByText(/Basis-Vertrag seit/)).toBeVisible();
      await ohneBefund(page);

      await page.getByRole("tab", { name: "Leistungen" }).click();
      await expect(page).toHaveURL(`/kunden/${i.kunde.id}?tab=leistungen`);
      const tabelle = page.getByRole("region", { name: "Verfügbarkeit je App und Monat" });
      await expect(tabelle.getByRole("columnheader")).toHaveCount(7);
      await expect(tabelle.locator("tbody tr").last()).toContainText("Alle Apps");
      await expect(page.getByText("Was der Vertrag enthält")).toBeVisible();
      await ohneBefund(page);

      await page.getByRole("tab", { name: "Support" }).click();
      await expect(page.getByRole("button", { name: "Zugang starten" })).toBeVisible();
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });
});
