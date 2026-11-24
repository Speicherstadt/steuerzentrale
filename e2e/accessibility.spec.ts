import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { installationAnlegen } from "./hilfen/installationen.ts";
import { kundeAnlegen } from "./hilfen/kunden.ts";
import { serverAnlegen } from "./hilfen/server.ts";

// Every page of the route tree, in light and dark, on the desktop and a phone, checked with axe; the
// `pages` check (checks.json) reads the paths in this file. Signed in, every page reads the
// Zentrale (Z-406), with whatever the other tests made there; the detail pages open one object of
// each kind made over the API (ECHT), the demo ids in the list only name them; a tab (`?tab=`)
// opens on the same kind of object.
// The session is the first owner's (e2e/einrichtung.setup.ts).
const pages = [
  "/",
  "/server",
  "/server/shared-2",
  "/server/shared-2?tab=auslastung",
  "/server/shared-2?tab=technik",
  "/apps",
  "/apps/lind-haben",
  "/updates",
  "/backups",
  "/kunden",
  "/kunden/praxis-weber",
  "/kunden/praxis-weber?tab=leistungen",
  "/kunden/praxis-weber?tab=support",
  "/support",
  "/leistungen",
  "/katalog",
  "/katalog/haben",
  "/protokoll",
  "/protokoll?tab=auftraege",
  "/protokoll?tab=aenderungen",
  "/einstellungen",
  // outside the shell (Z-104); with the first owner's session the setup shows its finished state
  "/anmelden",
  "/einrichtung",
  "/einladung",
  "/erster-inhaber",
  // the question after the first owner (Z-805); answered, it points to the settings
  "/betriebsart",
];

/** Old addresses and where they lead now; the catalog's old /apps has none, /apps means the apps */
const UMZUEGE = [
  ["/installationen", "/apps"],
  ["/installationen/lind-haben", "/apps/lind-haben"],
  ["/ereignisse", "/protokoll?tab=ereignisse"],
  ["/auftraege", "/protokoll?tab=auftraege"],
  ["/audit", "/protokoll?tab=aenderungen"],
] as const;

test.use({ locale: "de-DE" });

const ECHT: Record<string, (page: Page) => Promise<string>> = {
  "/server/shared-2": async (page) =>
    `/server/${(await serverAnlegen(page.request, "Gemeinsamer Server 2")).serverId}`,
  "/apps/lind-haben": async (page) => {
    const i = await installationAnlegen(page.request);
    i.agent.trennen();
    return `/apps/${i.installationId}`;
  },
  "/kunden/praxis-weber": async (page) =>
    `/kunden/${(await kundeAnlegen(page.request, "Praxis Weber")).id}`,
};

const pruefen = async (page: Page) => {
  await expect(page.locator("main h1")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  // Reflow (WCAG 1.4.10): wide tables scroll in their own box, the page never sideways
  const breite = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(breite[0]).toBeLessThanOrEqual(breite[1] ?? 0);
};

for (const theme of ["light", "dark"] as const) {
  test.describe(`in ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
    });

    for (const path of pages) {
      test(`axe finds nothing on ${path} @phone`, async ({ page }) => {
        const [ohneTab = path, tab] = path.split("?");
        const echt = await ECHT[ohneTab]?.(page);
        const ziel = echt ? `${echt}${tab ? `?${tab}` : ""}` : path;
        await page.goto(ziel);
        await expect(page).toHaveURL(ziel);
        await pruefen(page);
      });
    }

    // the addresses before the navigation of 2026-11 (docs/plan.md) lead to their new page
    for (const [alt, neu] of UMZUEGE) {
      test(`axe finds nothing where ${alt} leads @phone`, async ({ page }) => {
        await page.goto(alt);
        await expect(page).toHaveURL(neu);
        await pruefen(page);
      });
    }

    test("axe finds nothing in the navigation drawer", async ({ page }) => {
      // At phone width in both projects: the drawer replaces the sidebar below md
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await page.getByRole("button", { name: "Navigation", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  });
}
