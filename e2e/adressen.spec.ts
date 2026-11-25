import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { agentVerbinden } from "./hilfen/agent.ts";
import { manifestImportieren } from "./hilfen/installationen.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

// The zone and token the stand-in of Cloudflare's API accepts (apps/zentrale/src/testhilfen/
// cloudflare.ts, TEST_ZONE and TEST_TOKEN); the Zentrale of the e2e run talks only to it
// (playwright.config.ts). One domain for every run: the projects share one operator.
const DOMAIN = "apps.e2e.test";
const ZONE = "0123456789abcdef0123456789abcdef";
const TOKEN = "cf-test-token-3f9a2c7e1b5d4a6f8e0c2b4d";

const dnsSetzen = async (request: APIRequestContext) => {
  const antwort = await request.put("/api/v1/dns", {
    data: { domain: DOMAIN, zoneId: ZONE, token: TOKEN, grund: "Test" },
  });
  expect(antwort.status()).toBe(200);
};

const kuerzel = () => `kanzlei-${randomUUID().slice(0, 8)}`;

// BAULISTE.md Z-407 against the real Zentrale with the first owner's session: a customer's short
// name, the DNS settings with the token only as set, and the address the dialog suggests. Setting
// the records themselves is tested against the stand-in in apps/zentrale (modules/dns).
test.describe("addresses and DNS", { tag: "@phone" }, () => {
  test("a customer gets the short name given in its dialog", async ({ page }) => {
    const k = kuerzel();
    await page.goto("/kunden");
    await page.getByRole("button", { name: "Kunde anlegen" }).click();
    const dialog = page.getByRole("dialog", { name: "Kunde anlegen" });
    await dialog.getByLabel("Name des Kunden").fill(`Kanzlei ${k}`);
    await expect(dialog.getByText(/leer lassen schlägt eines aus dem Namen vor/)).toBeVisible();
    await dialog.getByLabel("Kürzel").fill(k);
    await dialog.getByLabel("Ansprechperson").fill("Mia Muster");
    await dialog.getByLabel("E-Mail-Adresse").fill("mia@kanzlei.test");
    await dialog.getByLabel("Vertragsbeginn").fill("2026-12-01");
    await expect(dialog.getByLabel("Grund")).toHaveCount(0);
    await ohneBefund(page);
    await dialog.getByRole("button", { name: "Anlegen" }).click();
    await expect(page).toHaveURL(/\/kunden\/[0-9a-f-]{36}$/);
    // in the card "Vertrag": the row "Kürzel" with it
    const zeile = page.locator("dl > div").filter({ hasText: "Kürzel" });
    await expect(zeile.getByText(k, { exact: true })).toBeVisible();
    await ohneBefund(page);
  });

  test("the DNS settings take the token and show it only as set", async ({ page }) => {
    await page.goto("/einstellungen?tab=dns");
    const karte = page.locator("section", { has: page.getByRole("heading", { name: "DNS" }) });
    await karte.getByLabel("Domain").fill(DOMAIN);
    await karte.getByLabel("Zone-ID").fill(ZONE);
    await karte.getByLabel("API-Token").fill(TOKEN);
    await expect(karte.getByLabel("Grund")).toHaveCount(0);
    await ohneBefund(page);
    await karte.getByRole("button", { name: "Speichern" }).click();
    await expect(karte.getByText("DNS-Einstellungen gespeichert.")).toBeVisible();
    await page.reload();
    const neu = page.locator("section", { has: page.getByRole("heading", { name: "DNS" }) });
    await expect(neu.getByLabel("Domain")).toHaveValue(DOMAIN);
    await expect(neu.getByLabel("API-Token")).toHaveValue("");
    await expect(neu.getByText("gesetzt; leer lassen behält den Token")).toBeVisible();
    await expect(page.getByText(TOKEN)).toHaveCount(0);
    const antwort = await page.request.get("/api/v1/dns");
    expect(await antwort.json()).toEqual({ domain: DOMAIN, zoneId: ZONE, tokenGesetzt: true });
    await ohneBefund(page);
  });

  test("the dialog suggests <app>.<kuerzel>.<domain>", async ({ page }) => {
    await dnsSetzen(page.request);
    const k = kuerzel();
    const kunde = await page.request.post("/api/v1/kunden", {
      data: {
        name: `Kanzlei ${k}`,
        kuerzel: k,
        kontakt: { name: "Petra Weber", email: "praxis@praxis-weber.test" },
        vertrag: { beginn: Date.UTC(2026, 4, 1, 22) },
        grund: "Test",
      },
    });
    const { id } = (await kunde.json()) as { id: string };
    const agent = await agentVerbinden(page.request, "Gemeinsamer Server");
    await manifestImportieren(page.request);
    try {
      await page.goto(`/kunden/${id}`);
      await page.getByRole("button", { name: "App installieren" }).click();
      const dialog = page.getByRole("dialog", { name: "App installieren" });
      await dialog.getByLabel("Server", { exact: true }).selectOption(agent.serverId);
      await dialog.getByLabel("App", { exact: true }).selectOption("probe");
      await dialog.getByLabel("Version", { exact: true }).selectOption("1.0.0");
      await expect(dialog.getByLabel("Adresse")).toHaveValue(`probe.${k}.${DOMAIN}`);
      await expect(dialog.getByText(`Unter ${DOMAIN} setzt die Zentrale A und AAAA`)).toBeVisible();
      await ohneBefund(page);
    } finally {
      agent.trennen();
    }
  });
});
