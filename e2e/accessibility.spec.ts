import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { kundeAnlegen } from "./hilfen/kunden.ts";

// Every page of the route tree, in light and dark, on the desktop and a phone, checked with axe; the
// `pages` check (checks.json) reads the paths in this file. The data are the demo fixtures
// (apps/web/src/demo/), the detail pages open one object of each kind. The session is the first
// owner's (e2e/einrichtung.setup.ts).
const pages = [
  "/",
  "/server",
  "/server/shared-2",
  "/installationen",
  "/installationen/lind-haben",
  "/updates",
  "/backups",
  "/auftraege",
  "/kunden",
  "/kunden/praxis-weber",
  "/support",
  "/leistungen",
  "/apps",
  "/ereignisse",
  "/audit",
  "/einstellungen",
  // outside the shell (Z-104); with the first owner's session the setup shows its finished state
  "/anmelden",
  "/einrichtung",
  "/einladung",
  "/erster-inhaber",
];

test.use({ locale: "de-DE" });

const ECHT: Record<string, (page: Page) => Promise<string>> = {
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
        const ziel = (await ECHT[path]?.(page)) ?? path;
        await page.goto(ziel);
        await expect(page).toHaveURL(ziel);
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
