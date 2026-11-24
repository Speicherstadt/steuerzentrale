import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// The pictures of README.md and docs/ from the demo (playwright.screenshots.config.ts). Each page in
// light and dark; the phone only for the overview. SCREENSHOT_DIR collects them (the workflow turns
// them into WebP under docs/assets/screenshots/); without it they land in test-results/.
const ziel =
  process.env.SCREENSHOT_DIR ?? join(import.meta.dirname, "../../test-results/screenshots");
mkdirSync(ziel, { recursive: true });

const THEMEN = [
  { name: "hell", colorScheme: "light" },
  { name: "dunkel", colorScheme: "dark" },
] as const;

/** A page of the demo by its hash route, ready once its heading stands */
const oeffnen = async (page: Page, route: string): Promise<void> => {
  await page.goto(`#${route}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
};

/** The first entry of a list page, opened by its link: the detail pages need no fixed ID */
const erstenOeffnen = async (page: Page, route: string, pfad: string): Promise<void> => {
  await oeffnen(page, route);
  await page.locator(`main a[href*="${pfad}/"]`).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
};

const SEITEN: { name: string; zeigen: (page: Page) => Promise<void> }[] = [
  { name: "uebersicht", zeigen: (page) => oeffnen(page, "/") },
  { name: "server", zeigen: (page) => oeffnen(page, "/server") },
  { name: "server-detail", zeigen: (page) => erstenOeffnen(page, "/server", "/server") },
  { name: "installationen", zeigen: (page) => oeffnen(page, "/installationen") },
  {
    name: "installation",
    zeigen: (page) => erstenOeffnen(page, "/installationen", "/installationen"),
  },
  { name: "updates", zeigen: (page) => oeffnen(page, "/updates") },
  { name: "backups", zeigen: (page) => oeffnen(page, "/backups") },
  { name: "kunden", zeigen: (page) => oeffnen(page, "/kunden") },
  { name: "apps", zeigen: (page) => oeffnen(page, "/apps") },
];

for (const thema of THEMEN) {
  test.describe(thema.name, () => {
    test.use({ colorScheme: thema.colorScheme });

    for (const seite of SEITEN) {
      test(seite.name, async ({ page }, info) => {
        test.skip(info.project.name !== "desktop", "the phone takes the overview only");
        await seite.zeigen(page);
        await page.screenshot({ path: join(ziel, `${seite.name}-${thema.name}.png`) });
      });
    }

    test("uebersicht auf dem Handy", async ({ page }, info) => {
      test.skip(info.project.name !== "phone", "phone only");
      await oeffnen(page, "/");
      await page.screenshot({ path: join(ziel, `handy-uebersicht-${thema.name}.png`) });
    });
  });
}
