import { expect, test } from "@playwright/test";

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

  test("shows the eight apps of the Speicherstadt", async ({ page }) => {
    await page.goto("/apps");
    const apps = page.locator("main h2");
    await expect(apps).toHaveText([
      "Haben",
      "Belegt",
      "Kontext",
      "Schreibzeug",
      "Stellwerk",
      "Fixpunkt",
      "Kennwort",
      "Soll",
    ]);
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

  test("leads from the overview to the cause of an entry", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("link", { name: /IT Berger · Schreibzeug/ })
      .first()
      .click();
    await expect(page).toHaveURL("/installationen/berger-schreibzeug");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("IT Berger · Schreibzeug");
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

test.describe("filters", () => {
  test("narrow the installations to red ones and by search", async ({ page }) => {
    await page.goto("/installationen");
    await page.getByRole("button", { name: /^Rot/ }).click();
    const tabelle = page.getByRole("region", { name: "Installationen" });
    await expect(tabelle.getByRole("link", { name: /IT Berger/ })).toBeVisible();
    await expect(tabelle.getByRole("link", { name: /Atelier Nord/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Alle/ }).click();
    await page.getByRole("button", { name: "Liste" }).click();
    await page.getByRole("searchbox", { name: "Installationen suchen" }).fill("holm");
    await expect(tabelle.locator("tbody tr")).toHaveCount(2);
  });
});
