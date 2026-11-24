import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { agentVerbinden } from "./hilfen/agent.ts";

test.use({ locale: "de-DE" });

// BAULISTE.md Z-701 against the real Zentrale with the first owner's session: the server page shows
// the operating system as the agent reports it and where its reboot stands; a reboot by hand with a
// reason goes to the stand-in agent (e2e/hilfen/agent.ts), which comes back on a new boot, and the
// page then shows the reboot done and its event. The operating system and the reboot stand in the
// tab "Technik", the button in the head, the event in "Verlauf". The agent's own side (`systemctl reboot`, the boot
// id) is tested in apps/agent, the real reboot in an Incus VM in CI (job `server`).
test.describe("the reboot of a server", { tag: "@phone" }, () => {
  test("shows the operating system and reboots by hand with a reason", async ({ page }) => {
    const agent = await agentVerbinden(page.request, "Neustart");
    try {
      await page.goto(`/server/${agent.serverId}?tab=technik`);
      const wartung = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Wartung", exact: true }) });
      await expect(wartung).toContainText("unattended-upgrades");
      await expect(wartung).toContainText("an, zuletzt");
      await expect(wartung).toContainText("Ausstehende Pakete0");
      await expect(wartung).toContainText("Neustart nötignein");
      await expect(wartung).toContainText("Nächster Neustartkeiner geplant");
      await expect(wartung).toContainText("Letzter Neustartnoch keiner");

      await page.getByRole("main").getByRole("button", { name: "Neu starten" }).click();
      const dialog = page.getByRole("dialog", { name: "Neu starten" });
      await expect(dialog).toContainText("vorher sichert die Zentrale jede laufende Installation");
      await dialog.getByLabel("Grund").fill("Kernel-Update, Kunden informiert");
      expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
      await dialog.getByRole("button", { name: "Neu starten" }).click();
      await expect(dialog).toBeHidden();

      // the stand-in rebooted and came back on a new boot: done, with its event
      await expect
        .poll(async () => {
          await page.reload();
          return (await wartung.textContent()) ?? "";
        })
        .toContain("Letzter Neustarterfolgreich (von Hand,");
      await page.getByRole("tab", { name: "Verlauf" }).click();
      await expect(page).toHaveURL(`/server/${agent.serverId}?tab=verlauf`);
      await expect(page.getByText(/Server neu gestartet \(Boot [0-9a-f-]{36}\)/)).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      agent.trennen();
    }
  });
});
