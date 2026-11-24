import { expect, test } from "@playwright/test";
import { installationAnlegen, neuerHost } from "./hilfen/installationen.ts";
import { rotGemeldet } from "./hilfen/zustand.ts";

test.use({ locale: "de-DE" });

test.describe("the interface", { tag: "@phone" }, () => {
  test("opens on the overview with what needs attention", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Braucht Aufmerksamkeit" })).toBeVisible();
  });

  test("reaches the Zentrale through the same origin", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  // the apps with a released manifest first; apps other tests imported (Z-501) follow them
  test("shows the apps of the Speicherstadt in the catalog", async ({ page }) => {
    await page.goto("/katalog");
    const apps = page.locator("main section h2 a");
    await expect
      .poll(async () => (await apps.allTextContents()).slice(0, 6))
      .toEqual(["Haben", "Belegt", "Kontext", "Schreibzeug", "Stellwerk", "Kennwort"]);
  });

  test("switches between light and dark and keeps the choice", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.getByRole("button", { name: "Hell oder dunkel" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Hell oder dunkel" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  // Z-406: the overview reads GET /api/v1/uebersicht; an installation the stand-in agent reports
  // red stands there as a fault and leads to its page
  test("leads from the overview to the cause of an entry", async ({ page }) => {
    const i = await installationAnlegen(page.request, neuerHost("laeuft"));
    try {
      await rotGemeldet(page.request, i);
      await page.goto("/");
      const eintrag = page
        .locator("section", { has: page.getByRole("heading", { name: "Braucht Aufmerksamkeit" }) })
        .getByRole("link", { name: new RegExp(`${i.kunde.name} · probe`) });
      await expect(eintrag).toContainText("Health: HTTP 503");
      await expect(eintrag.getByRole("img", { name: "Störung" })).toBeVisible();
      await eintrag.click();
      await expect(page).toHaveURL(`/apps/${i.installationId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${i.kunde.name} · probe`);
    } finally {
      i.agent.trennen();
    }
  });
});

// At phone width in both projects: the drawer replaces the sidebar below md
test.describe("at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("navigates through the drawer, which closes on the new page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Navigation", exact: true }).click();
    const schublade = page.getByRole("dialog", { name: "Navigation" });
    await schublade.getByRole("link", { name: "Kunden" }).click();
    await expect(page).toHaveURL("/kunden");
    await expect(schublade).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Kunden" })).toBeVisible();
  });
});

// The installations of the Zentrale (Z-402): a failed setup counts as red, one on its way not
test.describe("filters", () => {
  test("narrow the installations to red ones and by search", async ({ page }) => {
    const kaputt = await installationAnlegen(page.request, neuerHost("kaputt"));
    const unterwegs = await installationAnlegen(page.request);
    try {
      await expect
        .poll(async () => {
          const a = await page.request.get(`/api/v1/installationen/${kaputt.installationId}`);
          return ((await a.json()) as { zustand: string }).zustand;
        })
        .toBe("gescheitert");
      await page.goto("/apps");
      await page.getByRole("button", { name: /^Rot/ }).click();
      const tabelle = page.getByRole("region", { name: "Apps" });
      await expect(tabelle.getByRole("link", { name: new RegExp(kaputt.host) })).toBeVisible();
      await expect(tabelle.getByRole("link", { name: new RegExp(unterwegs.host) })).toHaveCount(0);
      await page.getByRole("button", { name: /^Alle/ }).click();
      await page.getByRole("button", { name: "Liste" }).click();
      await page.getByRole("searchbox", { name: "Apps suchen" }).fill(unterwegs.host);
      await expect(tabelle.locator("tbody tr")).toHaveCount(1);
      await expect(tabelle.locator("tbody tr")).toContainText("wird eingerichtet");
    } finally {
      kaputt.agent.trennen();
      unterwegs.agent.trennen();
    }
  });
});
