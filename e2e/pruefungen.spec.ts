import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { agentVerbinden } from "./hilfen/agent.ts";

test.use({ locale: "de-DE" });

const ohneBefund = async (page: Page) => {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
};

// BAULISTE.md Z-702: the Zentrale checks each server from its agent's facts; a check red or yellow
// stands in the overview and leads to the server, whose page shows every check with what it
// measured. The stand-in agent (e2e/hilfen/agent.ts) reports a disk 95 % full and port 5432 open.
test.describe("checks of a server", { tag: "@phone" }, () => {
  test("stand in the overview and on the server page", async ({ page }) => {
    const agent = await agentVerbinden(page.request, "Volle Platte", {
      platten: [{ mount: "/", gesamtMb: 1000, freiMb: 50 }],
      portsOffen: [
        { port: 22, proto: "tcp" },
        { port: 5432, proto: "tcp" },
      ],
    });
    try {
      await page.goto("/");
      const platte = page
        .getByRole("link", { name: /Platte: 95 % belegt \(Grenze 90 %\)/ })
        .filter({
          hasText: agent.name,
        });
      await expect(platte.getByRole("img", { name: "Störung" })).toBeVisible();
      const ports = page
        .getByRole("link", { name: /Offene Ports: 5432\/tcp: in keinem Manifest/ })
        .filter({ hasText: agent.name });
      await expect(ports.getByRole("img", { name: "Warnung" })).toBeVisible();
      await ohneBefund(page);

      await platte.click();
      await expect(page).toHaveURL(`/server/${agent.serverId}`);
      const karte = page.locator("section", {
        has: page.getByRole("heading", { name: "Prüfungen" }),
      });
      await expect(karte).toContainText("95 % belegt (Grenze 90 %)");
      await expect(karte).toContainText("5432/tcp: in keinem Manifest");
      await expect(karte).toContainText("NTP synchron, Abweichung 12 ms");
      await expect(karte).toContainText("alle jünger als 26 h");
      await ohneBefund(page);
    } finally {
      agent.trennen();
    }
  });
});
