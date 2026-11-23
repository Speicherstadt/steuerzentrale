import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { installationAnlegen } from "./hilfen/installationen.ts";
import { kundeAnlegen } from "./hilfen/kunden.ts";
import { serverAnlegen } from "./hilfen/server.ts";

// Every page of the route tree, in light and dark, on the desktop and a phone, checked with axe; the
// `pages` check (checks.json) reads the paths in this file. Signed in, every page reads the
// Zentrale (Z-406), with whatever the other tests made there; the detail pages open one object of
// each kind made over the API (ECHT), the demo ids in the list only name them.
// The session is the first owner's (e2e/einrichtung.setup.ts).
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
  "/server/shared-2": async (page) =>
    `/server/${(await serverAnlegen(page.request, "Gemeinsamer Server 2")).serverId}`,
  "/installationen/lind-haben": async (page) => {
    const i = await installationAnlegen(page.request);
    i.agent.trennen();
    return `/installationen/${i.installationId}`;
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
