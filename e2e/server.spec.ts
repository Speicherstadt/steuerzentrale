import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ locale: "de-DE" });

// BAULISTE.md Z-302: adding a server shows the install command with its one-time token once, in a
// dialog; signed in as the first owner (the session of the project `einrichtung`)
test.describe("adding a server", { tag: "@phone" }, () => {
  test("shows the install command with a one-time token", async ({ page }) => {
    await page.goto("/server");
    await page.getByRole("button", { name: "Server hinzufügen" }).click();
    const dialog = page.getByRole("dialog", { name: "Server hinzufügen" });
    await dialog.getByLabel("Name", { exact: true }).fill("Gemeinsamer Server 3");
    // Z-1205: every server is the operator's own for several customers, the dialog asks no kind
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog.getByText("Art", { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel("Kunde", { exact: true })).toHaveCount(0);
    await dialog.getByLabel("Grund").fill("neuer Server für die Kanzlei");
    expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
    await dialog.getByRole("button", { name: "Weiter" }).click();

    const befehl = page.getByRole("dialog", { name: "Befehl auf dem Server ausführen" });
    await expect(befehl.getByTestId("install-befehl")).toHaveText(
      /^curl -fsSL http:\/\/localhost:28300\/install\.sh \| sudo sh -s -- --token [A-Za-z0-9_-]{43}$/,
    );
    await expect(befehl.getByText("Gemeinsamer Server 3: als Root")).toBeVisible();
    expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
    await befehl.getByRole("button", { name: "Fertig" }).click();
    await expect(befehl).toBeHidden();
    // Z-304: the list comes from the Zentrale; the new server is there, without facts yet
    const zeile = page.getByRole("row").filter({ hasText: "Gemeinsamer Server 3" }).first();
    await expect(zeile).toContainText("noch keine Fakten");
  });
});
