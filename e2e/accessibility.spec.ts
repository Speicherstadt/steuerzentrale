import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// Every page of the route tree, in light and dark, on the desktop and a phone, checked with axe; the
// `pages` check (checks.json) reads the paths in this file. The data are the demo fixtures
// (apps/web/src/demo/), the detail pages open one object of each kind.
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
];

test.use({ locale: "de-DE" });

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
        await page.goto(path);
        await expect(page).toHaveURL(path);
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
