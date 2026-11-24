import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { agentVerbinden } from "./hilfen/agent.ts";
import { installationAnlegen, neuerHost } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

// BAULISTE.md Z-406: jobs, events, the audit log, a server's and a customer's installations come
// from the Zentrale; the data are made by the stand-in agent (e2e/hilfen/agent.ts). Every project
// and worker shares one Zentrale, so each test finds its own rows by their unique names.
test.describe("real data", { tag: "@phone" }, () => {
  test("lists a failed setup under the failed jobs, with its reason", async ({ page }) => {
    const i = await installationAnlegen(page.request, neuerHost("kaputt"));
    try {
      await expect
        .poll(async () => {
          const a = await page.request.get(`/api/v1/installationen/${i.installationId}`);
          return ((await a.json()) as { zustand: string }).zustand;
        })
        .toBe("gescheitert");
      await page.goto("/protokoll?tab=auftraege");
      await page.getByRole("tab", { name: "Gescheitert" }).click();
      const zeile = page.locator("tbody tr", { hasText: i.kunde.name }).first();
      await expect(zeile).toContainText("image ziehen: manifest unknown");
      await expect(zeile).toContainText("Einrichten");
      await ohneBefund(page);
      await zeile.getByRole("link", { name: `${i.kunde.name} · probe` }).click();
      await expect(page).toHaveURL(`/apps/${i.installationId}`);
    } finally {
      i.agent.trennen();
    }
  });

  test("shows an SSH login on the events, the server page and the overview", async ({ page }) => {
    const agent = await agentVerbinden(page.request, "Gemeinsamer Server");
    const nutzer = `notfall-${randomUUID().slice(0, 8)}`;
    try {
      agent.sshAnmelden(nutzer);
      await expect
        .poll(async () => {
          const a = await page.request.get(`/api/v1/ereignisse?ziel=server:${agent.serverId}`);
          return ((await a.json()) as { eintraege: unknown[] }).eintraege.length;
        })
        .toBe(1);
      const text = `SSH-Anmeldung auf ${agent.name}: ${nutzer}`;

      await page.goto("/protokoll?tab=ereignisse");
      await page.getByRole("tab", { name: "Warnungen" }).click();
      const ereignis = page.getByRole("listitem").filter({ hasText: text });
      await expect(ereignis).toBeVisible();
      await expect(ereignis.getByRole("img", { name: "Warnung" })).toBeVisible();
      await ohneBefund(page);
      await ereignis.getByRole("link", { name: agent.name }).click();
      await expect(page).toHaveURL(`/server/${agent.serverId}`);
      await expect(page.getByText(text)).toBeVisible();

      await page.goto("/");
      const zeile = page.getByRole("listitem").filter({ hasText: nutzer });
      await expect(zeile.getByRole("img", { name: "Warnung" })).toBeVisible();
      await zeile.getByRole("link", { name: new RegExp(nutzer) }).click();
      await expect(page).toHaveURL(`/server/${agent.serverId}`);
    } finally {
      agent.trennen();
    }
  });

  test("names in the audit log who made an installation, page by page", async ({ page }) => {
    const i = await installationAnlegen(page.request);
    i.agent.trennen();
    await page.goto("/protokoll?tab=aenderungen");
    const ziel = page.getByRole("link", { name: `${i.kunde.name} · probe` }).first();
    // other tests write meanwhile: read on until the entry is there
    for (let n = 0; n < 20 && !(await ziel.isVisible()); n++) {
      const mehr = page.getByRole("button", { name: "Mehr laden" });
      if (await mehr.isVisible()) await mehr.click();
      await page.waitForTimeout(200);
    }
    const zeile = page.locator("tbody tr", { has: ziel }).first();
    await expect(zeile).toContainText("installation.anlegen");
    await expect(zeile).toContainText("Test");
    await ohneBefund(page);
  });

  test("lists an installation on its server's and its customer's page", async ({ page }) => {
    const i = await installationAnlegen(page.request);
    try {
      await page.goto(`/server/${i.agent.serverId}`);
      await expect(
        page.getByRole("link", { name: new RegExp(`${i.kunde.name} · probe`) }),
      ).toBeVisible();
      await ohneBefund(page);
      await page.goto(`/kunden/${i.kunde.id}`);
      const karte = page.locator("section", {
        has: page.getByRole("heading", { name: "Apps" }),
      });
      await expect(karte.getByRole("link", { name: /probe/ })).toHaveAttribute(
        "href",
        `/apps/${i.installationId}`,
      );
      await expect(karte).toContainText(i.agent.name);
      await ohneBefund(page);
    } finally {
      i.agent.trennen();
    }
  });
});
