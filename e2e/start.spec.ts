import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installationAnlegen, neuerHost } from "./hilfen/installationen.ts";
import { rotGemeldet } from "./hilfen/zustand.ts";

test.use({ locale: "de-DE" });

test.describe("the interface", { tag: "@phone" }, () => {
  // docs/plan.md, "Übersicht (Oberfläche 2026-11)": the verdict, four tiles, "Zu tun", "Als
  // Nächstes" and "Von selbst erledigt"; events and jobs are in the Protokoll
  test("opens on the overview, which says whether anything needs you", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Übersicht" })).toBeAttached();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: /^(Alles läuft|1 Ding braucht dich|\d+ Dinge brauchen dich)$/,
      }),
    ).toBeVisible();
    for (const name of [
      "Server",
      "Apps",
      "Backups heute Nacht",
      "Zu tun",
      "Als Nächstes",
      "Von selbst erledigt",
    ])
      await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Letzte Ereignisse" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Zum Protokoll" })).toHaveAttribute(
      "href",
      "/protokoll",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  // the number beside "Übersicht" in the menu is the number of rows of "Zu tun"
  test("counts the rows of Zu tun in the menu", async ({ page }) => {
    // setting up an installation plus up to 30 s of reading the page again: more than the default
    // 30 s of a test once every spec runs against the one Zentrale at the same time (Z-1206)
    test.setTimeout(90_000);
    const i = await installationAnlegen(page.request, neuerHost("laeuft"));
    try {
      await rotGemeldet(page.request, i);
      const zuTun = page.locator("section", {
        has: page.getByRole("heading", { name: "Zu tun", exact: true }),
      });
      const zeilen = zuTun.locator("ul > li").filter({
        has: page.getByRole("img", { name: /^(Störung|Warnung)$/ }),
      });
      // other tests add and fix entries meanwhile: read the page again until all three agree
      await expect
        .poll(
          async () => {
            await page.goto("/");
            await expect(zuTun.getByText(`probe bei ${i.kunde.name} ist gestört`)).toBeVisible();
            const n = await zeilen.count();
            const urteil = await page.locator("main h2").first().textContent();
            const knopf = page.getByRole("button", { name: "Navigation", exact: true });
            if (await knopf.isVisible()) await knopf.click();
            const eintrag = page
              .getByRole("navigation", { name: "Bereiche" })
              .filter({ visible: true })
              .getByRole("link", { name: /^Übersicht/ });
            // on the phone the menu opens only now and reads its count a moment later
            await expect(eintrag).toHaveText(/^Übersicht\d+$/);
            const zahl = await eintrag.textContent();
            const erwartet = n === 1 ? "1 Ding braucht dich" : `${n} Dinge brauchen dich`;
            return urteil === erwartet && zahl === `Übersicht${n}`;
          },
          { timeout: 30_000 },
        )
        .toBe(true);
    } finally {
      i.agent.trennen();
    }
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
      const titel = `probe bei ${i.kunde.name} ist gestört`;
      const zeile = page
        .locator("section", { has: page.getByRole("heading", { name: "Zu tun", exact: true }) })
        .getByRole("listitem")
        .filter({ hasText: titel });
      await expect(zeile).toContainText("Health: HTTP 503");
      await expect(zeile.getByRole("img", { name: "Störung" })).toBeVisible();
      // the owner of the e2e Zentrale may look into it and restart it from here
      await expect(zeile.getByRole("button", { name: "Neustart" })).toBeVisible();
      await expect(zeile.getByRole("button", { name: "Log ansehen" })).toBeVisible();
      await zeile.getByRole("link", { name: titel }).click();
      await expect(page).toHaveURL(`/apps/${i.installationId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`probe · ${i.kunde.name}`);
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

// The apps of the Zentrale (Z-402): a failed setup needs someone, one on its way not
test.describe("filters", () => {
  test("narrow the apps to those that need someone and by search", async ({ page }) => {
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
      await page.getByRole("button", { name: /^Braucht dich/ }).click();
      const tabelle = page.getByRole("region", { name: "Apps" });
      const link = (id: string) => tabelle.locator(`a[href="/apps/${id}"]`);
      await expect(link(kaputt.installationId)).toBeVisible();
      await expect(link(unterwegs.installationId)).toHaveCount(0);
      await page.getByRole("button", { name: /^Alle/ }).click();
      await page.getByRole("searchbox", { name: "Apps suchen" }).fill(unterwegs.host);
      await expect(tabelle.locator("tbody tr")).toHaveCount(1);
      await expect(tabelle.locator("tbody tr")).toContainText("wird eingerichtet");
    } finally {
      kaputt.agent.trennen();
      unterwegs.agent.trennen();
    }
  });
});
